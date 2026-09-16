import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation } from "./_generated/server";
import {
  ensureVerifiedIdentityUser,
  linkVerifiedIdentityMembershipPage,
} from "./lib/memberships";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildRetentionCutoffs,
  isTerminalNotificationStatus,
  shouldRetireInactiveMembership,
} from "./domain/retention";

const INTERNAL_IDENTITY_SECRET_ENV = "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET";

export const linkVerifiedIdentityMemberships = internalMutation({
  args: {
    emailIdentityId: v.id("emailIdentities"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await linkVerifiedIdentityMembershipPage(
      ctx,
      args.emailIdentityId,
      args.paginationOpts,
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.maintenance.linkVerifiedIdentityMemberships,
        {
          emailIdentityId: args.emailIdentityId,
          paginationOpts: { numItems: 100, cursor: page.continueCursor },
        },
      );
    }
    return null;
  },
});

const retentionWindowArgs = v.optional(
  v.object({
    anonymousMeetingMs: v.optional(v.number()),
    inactiveMembershipMs: v.optional(v.number()),
    expiredMagicLinkMs: v.optional(v.number()),
    revokedCredentialMs: v.optional(v.number()),
    staleNotificationMs: v.optional(v.number()),
    staleRateLimitMs: v.optional(v.number()),
  }),
);

export const cleanupRetainedData = mutation({
  args: {
    internalSecret: v.string(),
    now: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    windows: retentionWindowArgs,
    meetingPagination: v.optional(paginationOptsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    expiredMagicLinks: v.number(),
    staleNotifications: v.number(),
    retiredInactiveMemberships: v.number(),
    revokedApiTokens: v.number(),
    staleMembershipAccessTokens: v.number(),
    staleRateLimits: v.number(),
    anonymousMeetings: v.number(),
    cascadedAvailabilityRecords: v.number(),
    cascadedAllowedTimeRanges: v.number(),
    cascadedMemberships: v.number(),
    cascadedAccessTokens: v.number(),
    cascadedNotifications: v.number(),
    cascadedAuditEvents: v.number(),
    meetingContinueCursor: v.string(),
    meetingScanDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (!Number.isInteger(limit)) {
      throw new Error("Cleanup limit must be an integer");
    }
    if (
      args.meetingPagination &&
      (!Number.isInteger(args.meetingPagination.numItems) ||
        args.meetingPagination.numItems < 1 ||
        args.meetingPagination.numItems > Math.min(limit, 25))
    ) {
      throw new Error("Meeting cleanup page size must be between 1 and 25");
    }
    const cutoffs = buildRetentionCutoffs(now, args.windows ?? {});
    const summary = {
      dryRun,
      expiredMagicLinks: 0,
      staleNotifications: 0,
      retiredInactiveMemberships: 0,
      revokedApiTokens: 0,
      staleMembershipAccessTokens: 0,
      staleRateLimits: 0,
      anonymousMeetings: 0,
      cascadedAvailabilityRecords: 0,
      cascadedAllowedTimeRanges: 0,
      cascadedMemberships: 0,
      cascadedAccessTokens: 0,
      cascadedNotifications: 0,
      cascadedAuditEvents: 0,
    };

    for (const magicLink of await ctx.db
      .query("magicLinks")
      .withIndex("by_expiration", (q) =>
        q.lte("expiresAt", cutoffs.expiredMagicLinkBefore),
      )
      .take(limit)) {
      summary.expiredMagicLinks += 1;
      if (!dryRun) {
        await ctx.db.delete(magicLink._id);
      }
    }

    for (const status of ["sent", "failed", "cancelled"] as const) {
      const notifications = await ctx.db
        .query("notificationOutbox")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", status).lte("updatedAt", cutoffs.staleNotificationBefore),
        )
        .take(limit - summary.staleNotifications);
      for (const notification of notifications) {
        if (!isTerminalNotificationStatus(notification.status)) {
          continue;
        }
        summary.staleNotifications += 1;
        if (!dryRun) {
          await ctx.db.delete(notification._id);
        }
      }
      if (summary.staleNotifications >= limit) {
        break;
      }
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_updated_at", (q) =>
        q.lte("updatedAt", cutoffs.inactiveMembershipBefore),
      )
      .take(limit);
    for (const membership of memberships) {
      const availability = await ctx.db
        .query("availabilityRecords")
        .withIndex("by_membership", (q) => q.eq("membershipId", membership._id))
        .first();
      if (
        shouldRetireInactiveMembership({
          role: membership.role,
          emailIdentityId: membership.emailIdentityId,
          revokedAt: membership.revokedAt,
          updatedAt: membership.updatedAt,
          tokenLastUsedAt: membership.tokenLastUsedAt,
          hasAvailability: Boolean(availability),
          cutoff: cutoffs.inactiveMembershipBefore,
        })
      ) {
        summary.retiredInactiveMemberships += 1;
        if (!dryRun) {
          await ctx.db.patch(membership._id, {
            revokedAt: now,
            updatedAt: now,
          });
        }
      }
      if (summary.retiredInactiveMemberships >= limit) {
        break;
      }
    }

    for (const token of await ctx.db
      .query("apiTokens")
      .withIndex("by_revoked_at", (q) =>
        q.gt("revokedAt", 0).lte("revokedAt", cutoffs.revokedCredentialBefore),
      )
      .take(limit)) {
      summary.revokedApiTokens += 1;
      if (!dryRun) {
        await ctx.db.delete(token._id);
      }
    }

    for (const token of await ctx.db
      .query("membershipAccessTokens")
      .withIndex("by_revoked_at", (q) =>
        q.gt("revokedAt", 0).lte("revokedAt", cutoffs.revokedCredentialBefore),
      )
      .take(limit)) {
      summary.staleMembershipAccessTokens += 1;
      if (!dryRun) {
        await ctx.db.delete(token._id);
      }
    }
    if (summary.staleMembershipAccessTokens < limit) {
      const neverUsedAccessTokens = await ctx.db
        .query("membershipAccessTokens")
        .withIndex("by_created_at", (q) =>
          q.lte("createdAt", cutoffs.revokedCredentialBefore),
        )
        .take(limit - summary.staleMembershipAccessTokens);
      for (const token of neverUsedAccessTokens) {
        if (token.revokedAt !== undefined || token.tokenLastUsedAt !== undefined) {
          continue;
        }
        summary.staleMembershipAccessTokens += 1;
        if (!dryRun) {
          await ctx.db.delete(token._id);
        }
      }
    }

    for (const rateLimit of await ctx.db
      .query("rateLimits")
      .withIndex("by_expiration", (q) => q.lte("expiresAt", cutoffs.staleRateLimitBefore))
      .take(limit)) {
      summary.staleRateLimits += 1;
      if (!dryRun) {
        await ctx.db.delete(rateLimit._id);
      }
    }

    const progress = await ctx.db
      .query("maintenanceCursors")
      .withIndex("by_job", (q) => q.eq("job", "anonymousMeetings"))
      .unique();
    const resumeSavedScan = !dryRun && !args.meetingPagination && progress?.cursor;
    const meetingCutoff = resumeSavedScan
      ? progress.cutoff
      : cutoffs.anonymousMeetingBefore;
    const meetingPage = await ctx.db
      .query("meetings")
      .withIndex("by_created_at", (q) => q.lte("createdAt", meetingCutoff))
      .paginate(
        args.meetingPagination ?? {
          numItems: Math.min(limit, 25),
          cursor: resumeSavedScan ? progress.cursor : null,
        },
      );
    for (const meeting of meetingPage.page) {
      const meetingMemberships = await ctx.db
        .query("memberships")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();
      if (
        meetingMemberships.length === 0 ||
        meetingMemberships.some((membership) => membership.emailIdentityId)
      ) {
        continue;
      }
      const latestMembershipActivity = Math.max(
        ...meetingMemberships.map(
          (membership) => membership.tokenLastUsedAt ?? membership.updatedAt,
        ),
      );
      if (latestMembershipActivity > meetingCutoff) {
        continue;
      }
      await countOrDeleteAnonymousMeeting(ctx, meeting, dryRun, summary);
    }

    // Advance even when every row was protected. Dry runs never consume saved progress.
    if (!dryRun) {
      const nextProgress = {
        job: "anonymousMeetings",
        cursor: meetingPage.isDone ? null : meetingPage.continueCursor,
        cutoff: meetingCutoff,
      };
      if (progress) {
        await ctx.db.patch(progress._id, nextProgress);
      } else {
        await ctx.db.insert("maintenanceCursors", nextProgress);
      }
    }
    return {
      ...summary,
      meetingContinueCursor: meetingPage.continueCursor,
      meetingScanDone: meetingPage.isDone,
    };
  },
});

/** Repeat with continueCursor until isDone. Existing owners are never overwritten. */
export const backfillMembershipUsers = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    updated: v.number(),
    scanned: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    ) {
      throw new Error("Backfill page size must be between 1 and 100");
    }
    const page = await ctx.db
      .query("memberships")
      .withIndex("by_creation_time")
      .paginate(args.paginationOpts);
    let updated = 0;
    for (const membership of page.page) {
      if (
        membership.userId ||
        !membership.emailIdentityId ||
        membership.revokedAt !== undefined
      ) {
        continue;
      }
      const identity = await ctx.db.get(membership.emailIdentityId);
      if (!identity || identity.verifiedAt === undefined) {
        continue;
      }
      const userId = await ensureVerifiedIdentityUser(ctx, identity, Date.now());
      await ctx.db.patch(membership._id, { userId });
      updated += 1;
    }
    return {
      updated,
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

async function countOrDeleteAnonymousMeeting(
  ctx: MutationCtx,
  meeting: Doc<"meetings">,
  dryRun: boolean,
  summary: {
    anonymousMeetings: number;
    cascadedAvailabilityRecords: number;
    cascadedAllowedTimeRanges: number;
    cascadedMemberships: number;
    cascadedAccessTokens: number;
    cascadedNotifications: number;
    cascadedAuditEvents: number;
  },
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const membershipIds = new Set<Id<"memberships">>(
    memberships.map((membership) => membership._id),
  );
  const availabilityRecords = await ctx.db
    .query("availabilityRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const allowedTimeRanges = await ctx.db
    .query("allowedTimeRanges")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const notifications = await ctx.db
    .query("notificationOutbox")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const auditEvents = await ctx.db
    .query("auditEvents")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const accessTokens = [];
  for (const membership of memberships) {
    accessTokens.push(
      ...(await ctx.db
        .query("membershipAccessTokens")
        .withIndex("by_membership", (q) => q.eq("membershipId", membership._id))
        .collect()),
    );
  }

  summary.anonymousMeetings += 1;
  summary.cascadedAvailabilityRecords += availabilityRecords.length;
  summary.cascadedAllowedTimeRanges += allowedTimeRanges.length;
  summary.cascadedMemberships += memberships.length;
  summary.cascadedAccessTokens += accessTokens.length;
  summary.cascadedNotifications += notifications.length;
  summary.cascadedAuditEvents += auditEvents.length;

  if (dryRun) {
    return;
  }

  for (const record of availabilityRecords) {
    await ctx.db.delete(record._id);
  }
  for (const range of allowedTimeRanges) {
    await ctx.db.delete(range._id);
  }
  for (const token of accessTokens) {
    if (membershipIds.has(token.membershipId)) {
      await ctx.db.delete(token._id);
    }
  }
  for (const notification of notifications) {
    await ctx.db.delete(notification._id);
  }
  for (const event of auditEvents) {
    await ctx.db.delete(event._id);
  }
  for (const membership of memberships) {
    await ctx.db.delete(membership._id);
  }
  await ctx.db.delete(meeting._id);
}

async function assertInternalIdentitySecret(providedSecret: string): Promise<void> {
  const expectedSecret = process.env[INTERNAL_IDENTITY_SECRET_ENV];
  if (
    !expectedSecret ||
    !(await constantTimeEqualString(providedSecret, expectedSecret))
  ) {
    throw new Error("Internal maintenance authorization failed");
  }
}

async function constantTimeEqualString(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length, 1);
  const paddedLeft = new Uint8Array(maxLength);
  const paddedRight = new Uint8Array(maxLength);
  paddedLeft.set(leftBytes.slice(0, maxLength));
  paddedRight.set(rightBytes.slice(0, maxLength));

  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= paddedLeft[index] ^ paddedRight[index];
  }
  return diff === 0;
}
