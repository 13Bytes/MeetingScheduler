import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  buildRetentionCutoffs,
  isTerminalNotificationStatus,
  shouldRetireInactiveMembership,
} from "./domain/retention";

const INTERNAL_IDENTITY_SECRET_ENV = "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET";

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
  },
  handler: async (ctx, args) => {
    await assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
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

    for (const meeting of await ctx.db
      .query("meetings")
      .withIndex("by_created_at", (q) =>
        q.lte("createdAt", cutoffs.anonymousMeetingBefore),
      )
      .take(Math.min(limit, 25))) {
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
      if (latestMembershipActivity > cutoffs.anonymousMeetingBefore) {
        continue;
      }
      await countOrDeleteAnonymousMeeting(ctx, meeting, dryRun, summary);
      if (summary.anonymousMeetings >= limit) {
        break;
      }
    }

    return summary;
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
