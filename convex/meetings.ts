import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAvailabilityCellAlignment,
  assertCanAdminister,
  assertCanEditOpenMeeting,
  getMembershipCapabilities,
  isSlotInsideAllowedRanges,
  makeAvailabilityCellKey,
  normalizeEmailAddress,
  normalizeFinalizedSlot,
  normalizeMeetingSettings,
  normalizeMeetingTitle,
  slugifyMeetingTitle,
  transitionMeetingLifecycle,
} from "./domain/model";
import type { MembershipRole, PrivacyMode } from "./domain/model";
import { createSecretToken, hashSecretToken } from "./domain/tokens";
import {
  adminModeValidator,
  availabilityResponseValidator,
  finalizedSlotValidator,
  membershipRoleValidator,
  privacyModeValidator,
} from "./domain/validators";

const MAX_MAGIC_LINK_TTL_MS = 30 * 60 * 1000;

const meetingSettingsArgs = {
  canonicalTimeZone: v.optional(v.string()),
  granularityMinutes: v.optional(v.number()),
  durationMinutes: v.optional(v.number()),
  allowedTimeRanges: v.optional(
    v.array(
      v.object({
        startUtc: v.string(),
        endUtc: v.string(),
        timeZone: v.optional(v.string()),
        label: v.optional(v.string()),
      }),
    ),
  ),
};

export const createMeeting = mutation({
  args: {
    title: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    creatorName: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    creatorPrivacyMode: v.optional(privacyModeValidator),
    adminMode: v.optional(adminModeValidator),
    settings: v.optional(v.object(meetingSettingsArgs)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const title = normalizeMeetingTitle(args.title);
    const settings = normalizeMeetingSettings(args.settings);
    if (settings.allowedTimeRanges.length === 0) {
      throw new Error("Meeting creation requires at least one allowed time range");
    }

    const adminToken = await createSecretToken("membership");
    const slugBase = slugifyMeetingTitle(args.slug ?? title);
    const slug =
      args.slug === undefined
        ? `${slugBase}-${adminToken.tokenFingerprint.slice(0, 6)}`
        : slugBase;

    const existingMeeting = await ctx.db
      .query("meetings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existingMeeting) {
      throw new Error("A meeting with this slug already exists");
    }

    const emailIdentityId = args.creatorEmail
      ? await upsertEmailIdentity(ctx, args.creatorEmail, args.creatorName, now)
      : undefined;

    const meetingId = await ctx.db.insert("meetings", {
      title,
      slug,
      description: args.description?.trim(),
      lifecycleState: "open",
      lifecycleRevision: 1,
      adminMode: args.adminMode ?? "roleBased",
      canonicalTimeZone: settings.canonicalTimeZone,
      granularityMinutes: settings.granularityMinutes,
      durationMinutes: settings.durationMinutes,
      allowedTimeRanges: settings.allowedTimeRanges,
      createdAt: now,
      updatedAt: now,
    });

    const adminMembershipId = await ctx.db.insert("memberships", {
      meetingId,
      emailIdentityId,
      displayName: args.creatorName?.trim(),
      role: "admin",
      privacyMode: args.creatorPrivacyMode ?? "detailed",
      tokenHash: adminToken.tokenHash,
      tokenFingerprint: adminToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(meetingId, {
      createdByMembershipId: adminMembershipId,
      updatedAt: now,
    });

    await insertAllowedTimeRanges(ctx, {
      meetingId,
      ranges: settings.allowedTimeRanges,
      createdByMembershipId: adminMembershipId,
      now,
    });

    await insertAuditEvent(ctx, {
      meetingId,
      actorMembershipId: adminMembershipId,
      kind: "meeting.created",
      metadata: { slug, adminMode: args.adminMode ?? "roleBased" },
      now,
    });

    return {
      meetingId,
      adminMembershipId,
      slug,
      adminMembershipToken: adminToken.rawToken,
    };
  },
});

export const readMeetingBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_slug", (q) => q.eq("slug", slugifyMeetingTitle(args.slug)))
      .unique();
    if (!meeting) {
      return null;
    }

    const allowedRanges = await ctx.db
      .query("allowedTimeRanges")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .collect();

    return {
      meeting,
      allowedRanges,
      capabilities: getMembershipCapabilities(meeting, null),
    };
  },
});

export const readMeetingByMembershipToken = query({
  args: {
    membershipToken: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await findMembershipByToken(ctx, args.membershipToken);
    if (!membership) {
      return null;
    }

    const meeting = await ctx.db.get(membership.meetingId);
    if (!meeting) {
      return null;
    }

    return {
      meeting,
      membership: redactMembership(membership),
      capabilities: getMembershipCapabilities(meeting, membership),
    };
  },
});

export const createMembership = mutation({
  args: {
    meetingSlug: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(membershipRoleValidator),
    privacyMode: v.optional(privacyModeValidator),
    createdByMembershipToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_slug", (q) => q.eq("slug", slugifyMeetingTitle(args.meetingSlug)))
      .unique();
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }

    const requestedRole: MembershipRole = args.role ?? "member";
    let actorMembershipId: Id<"memberships"> | undefined;
    if (requestedRole === "admin") {
      const actor = args.createdByMembershipToken
        ? await findMembershipByToken(ctx, args.createdByMembershipToken)
        : null;
      if (actor?.meetingId !== meeting._id) {
        throw new Error("Admin creator must belong to this meeting");
      }
      assertCanAdminister(meeting, actor);
      actorMembershipId = actor?._id;
    }

    const emailIdentityId = args.email
      ? await upsertEmailIdentity(ctx, args.email, args.displayName, now)
      : undefined;
    const membershipToken = await createSecretToken("membership");
    const membershipId = await ctx.db.insert("memberships", {
      meetingId: meeting._id,
      emailIdentityId,
      displayName: args.displayName?.trim(),
      role: requestedRole,
      privacyMode: args.privacyMode ?? "detailed",
      tokenHash: membershipToken.tokenHash,
      tokenFingerprint: membershipToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId,
      targetMembershipId: membershipId,
      kind: "membership.created",
      metadata: { role: requestedRole },
      now,
    });

    return {
      meetingId: meeting._id,
      membershipId,
      membershipToken: membershipToken.rawToken,
    };
  },
});

export const updateMeetingSettings = mutation({
  args: {
    membershipToken: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    adminMode: v.optional(adminModeValidator),
    settings: v.optional(v.object(meetingSettingsArgs)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    const meeting = await requireMeeting(ctx, membership.meetingId);
    assertCanEditOpenMeeting(meeting, membership);

    const normalizedSettings = args.settings
      ? normalizeMeetingSettings({
          canonicalTimeZone: args.settings.canonicalTimeZone ?? meeting.canonicalTimeZone,
          granularityMinutes:
            args.settings.granularityMinutes ?? meeting.granularityMinutes,
          durationMinutes: args.settings.durationMinutes ?? meeting.durationMinutes,
          allowedTimeRanges: args.settings.allowedTimeRanges ?? meeting.allowedTimeRanges,
        })
      : undefined;

    await ctx.db.patch(meeting._id, {
      ...(args.title !== undefined ? { title: args.title.trim() } : {}),
      ...(args.description !== undefined ? { description: args.description.trim() } : {}),
      ...(args.adminMode !== undefined ? { adminMode: args.adminMode } : {}),
      ...(normalizedSettings
        ? {
            canonicalTimeZone: normalizedSettings.canonicalTimeZone,
            granularityMinutes: normalizedSettings.granularityMinutes,
            durationMinutes: normalizedSettings.durationMinutes,
            allowedTimeRanges: normalizedSettings.allowedTimeRanges,
          }
        : {}),
      updatedAt: now,
    });

    if (normalizedSettings) {
      await replaceAllowedTimeRanges(ctx, {
        meetingId: meeting._id,
        ranges: normalizedSettings.allowedTimeRanges,
        createdByMembershipId: membership._id,
        now,
      });
    }

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "meeting.settings_updated",
      metadata: { changedSettings: Boolean(normalizedSettings) },
      now,
    });

    return { meetingId: meeting._id };
  },
});

export const finalizeMeeting = mutation({
  args: {
    membershipToken: v.string(),
    finalizedSlot: v.optional(finalizedSlotValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    const meeting = await requireMeeting(ctx, membership.meetingId);
    const nextLifecycleState = transitionMeetingLifecycle(
      meeting,
      membership,
      "finalize",
    );
    const finalizedSlot = args.finalizedSlot
      ? normalizeFinalizedSlot(args.finalizedSlot, meeting)
      : undefined;

    await ctx.db.patch(meeting._id, {
      lifecycleState: nextLifecycleState,
      lifecycleRevision: meeting.lifecycleRevision + 1,
      finalizedAt: now,
      finalizedByMembershipId: membership._id,
      finalizedSlot,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "meeting.finalized",
      metadata: {},
      now,
    });

    return { meetingId: meeting._id, lifecycleState: nextLifecycleState };
  },
});

export const reopenMeeting = mutation({
  args: {
    membershipToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    const meeting = await requireMeeting(ctx, membership.meetingId);
    const nextLifecycleState = transitionMeetingLifecycle(meeting, membership, "reopen");

    await ctx.db.patch(meeting._id, {
      lifecycleState: nextLifecycleState,
      lifecycleRevision: meeting.lifecycleRevision + 1,
      finalizedAt: undefined,
      finalizedByMembershipId: undefined,
      finalizedSlot: undefined,
      reopenedAt: now,
      reopenedByMembershipId: membership._id,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "meeting.reopened",
      metadata: {},
      now,
    });

    return { meetingId: meeting._id, lifecycleState: nextLifecycleState };
  },
});

export const createMagicLink = mutation({
  args: {
    email: v.string(),
    displayName: v.optional(v.string()),
    purpose: v.union(v.literal("emailVerification"), v.literal("membershipRecovery")),
    membershipId: v.optional(v.id("memberships")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.expiresAt <= now) {
      throw new Error("Magic link expiry must be in the future");
    }
    if (args.expiresAt - now > MAX_MAGIC_LINK_TTL_MS) {
      throw new Error("Magic link expiry exceeds the maximum lifetime");
    }

    const emailIdentityId = await upsertEmailIdentity(
      ctx,
      args.email,
      args.displayName,
      now,
    );
    const recoveryTarget = await validateMagicLinkTarget(ctx, {
      purpose: args.purpose,
      emailIdentityId,
      membershipId: args.membershipId,
    });
    const magicLinkToken = await createSecretToken("magicLink");
    const magicLinkId = await ctx.db.insert("magicLinks", {
      purpose: args.purpose,
      emailIdentityId,
      meetingId: recoveryTarget.meetingId,
      membershipId: recoveryTarget.membershipId,
      tokenHash: magicLinkToken.tokenHash,
      tokenFingerprint: magicLinkToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      expiresAt: args.expiresAt,
      createdAt: now,
    });

    await ctx.db.insert("notificationOutbox", {
      meetingId: recoveryTarget.meetingId,
      membershipId: recoveryTarget.membershipId,
      emailIdentityId,
      kind: `magicLink.${args.purpose}`,
      status: "pending",
      dedupeKey: `magicLink:${magicLinkToken.tokenFingerprint}`,
      payload: {
        magicLinkId,
        tokenFingerprint: magicLinkToken.tokenFingerprint,
      },
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      magicLinkId,
      tokenFingerprint: magicLinkToken.tokenFingerprint,
      deliveryQueued: true,
    };
  },
});

export const upsertAvailabilityRecord = mutation({
  args: {
    membershipToken: v.string(),
    startUtc: v.string(),
    endUtc: v.string(),
    timeZone: v.optional(v.string()),
    response: availabilityResponseValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    const meeting = await requireMeeting(ctx, membership.meetingId);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }

    assertAvailabilityCellAlignment(
      args.startUtc,
      args.endUtc,
      meeting.granularityMinutes,
      args.timeZone ?? meeting.canonicalTimeZone,
    );
    if (
      !isSlotInsideAllowedRanges(
        { startUtc: args.startUtc, endUtc: args.endUtc },
        meeting.allowedTimeRanges,
      )
    ) {
      throw new Error("Availability cell must be inside an allowed time range");
    }

    const cellKey = makeAvailabilityCellKey(args.startUtc, args.endUtc);
    const [normalizedStartUtc, normalizedEndUtc] = cellKey.split("_") as [string, string];
    const existingRecord = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_membership_cell", (q) =>
        q.eq("membershipId", membership._id).eq("cellKey", cellKey),
      )
      .unique();

    const recordFields = {
      meetingId: meeting._id,
      membershipId: membership._id,
      startUtc: normalizedStartUtc,
      endUtc: normalizedEndUtc,
      timeZone: args.timeZone ?? meeting.canonicalTimeZone,
      cellKey,
      response: args.response,
      note: args.note?.trim(),
      updatedAt: now,
    };

    if (existingRecord) {
      await ctx.db.patch(existingRecord._id, recordFields);
      return { availabilityRecordId: existingRecord._id };
    }

    const availabilityRecordId = await ctx.db.insert("availabilityRecords", {
      ...recordFields,
      createdAt: now,
    });
    return { availabilityRecordId };
  },
});

export const listAvailabilityByMeeting = query({
  args: {
    membershipToken: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await findMembershipByToken(ctx, args.membershipToken);
    if (!membership) {
      return null;
    }

    const meeting = await requireMeeting(ctx, membership.meetingId);
    const records = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .collect();

    return {
      meetingId: meeting._id,
      requestingMembership: redactMembership(membership),
      records,
    };
  },
});

export const consumeMagicLink = mutation({
  args: {
    magicLinkToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await hashSecretToken(args.magicLinkToken);
    const magicLink = await ctx.db
      .query("magicLinks")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!magicLink || magicLink.consumedAt || magicLink.expiresAt <= now) {
      throw new Error("Magic link is invalid or expired");
    }

    await ctx.db.patch(magicLink._id, { consumedAt: now });
    return {
      magicLinkId: magicLink._id,
      purpose: magicLink.purpose,
      emailIdentityId: magicLink.emailIdentityId,
      meetingId: magicLink.meetingId,
      membershipId: magicLink.membershipId,
    };
  },
});

async function findMembershipByToken(ctx: QueryLikeCtx, membershipToken: string) {
  const tokenHash = await hashSecretToken(membershipToken);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (!membership || membership.revokedAt !== undefined) {
    return null;
  }

  return membership;
}

async function requireMembershipByToken(ctx: MutationLikeCtx, membershipToken: string) {
  const membership = await findMembershipByToken(ctx, membershipToken);
  if (!membership) {
    throw new Error("Membership token is invalid");
  }

  const now = Date.now();
  await ctx.db.patch(membership._id, {
    tokenLastUsedAt: now,
    updatedAt: now,
  });
  return membership;
}

async function requireMeeting(ctx: QueryLikeCtx, meetingId: Id<"meetings">) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) {
    throw new Error("Meeting not found");
  }
  return meeting;
}

async function upsertEmailIdentity(
  ctx: MutationLikeCtx,
  email: string,
  displayName: string | undefined,
  now: number,
) {
  const normalizedEmail = normalizeEmailAddress(email);
  const existingIdentity = await ctx.db
    .query("emailIdentities")
    .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
    .unique();

  if (existingIdentity) {
    await ctx.db.patch(existingIdentity._id, {
      ...(displayName ? { displayName: displayName.trim() } : {}),
      updatedAt: now,
    });
    return existingIdentity._id;
  }

  return await ctx.db.insert("emailIdentities", {
    normalizedEmail,
    displayName: displayName?.trim(),
    createdAt: now,
    updatedAt: now,
  });
}

async function validateMagicLinkTarget(
  ctx: MutationLikeCtx,
  args: {
    purpose: "emailVerification" | "membershipRecovery";
    emailIdentityId: Id<"emailIdentities">;
    membershipId?: Id<"memberships">;
  },
) {
  if (args.purpose === "emailVerification") {
    if (args.membershipId) {
      throw new Error("Email verification links cannot target a membership");
    }
    return {
      meetingId: undefined,
      membershipId: undefined,
    };
  }

  if (!args.membershipId) {
    throw new Error("Membership recovery links require a membershipId");
  }

  const membership = await ctx.db.get(args.membershipId);
  if (!membership || membership.revokedAt !== undefined) {
    throw new Error("Membership recovery target is invalid");
  }
  if (membership.emailIdentityId !== args.emailIdentityId) {
    throw new Error("Membership recovery email does not match the membership");
  }

  return {
    meetingId: membership.meetingId,
    membershipId: membership._id,
  };
}

async function replaceAllowedTimeRanges(
  ctx: MutationLikeCtx,
  args: {
    meetingId: Id<"meetings">;
    ranges: {
      startUtc: string;
      endUtc: string;
      timeZone: string;
      label?: string;
    }[];
    createdByMembershipId?: Id<"memberships">;
    now: number;
  },
) {
  const existingRanges = await ctx.db
    .query("allowedTimeRanges")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();

  for (const range of existingRanges) {
    await ctx.db.delete(range._id);
  }

  await insertAllowedTimeRanges(ctx, args);
  await pruneAvailabilityOutsideRanges(ctx, args.meetingId, args.ranges);
}

async function pruneAvailabilityOutsideRanges(
  ctx: MutationLikeCtx,
  meetingId: Id<"meetings">,
  allowedTimeRanges: {
    startUtc: string;
    endUtc: string;
    timeZone: string;
    label?: string;
  }[],
) {
  const records = await ctx.db
    .query("availabilityRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();

  for (const record of records) {
    if (!isSlotInsideAllowedRanges(record, allowedTimeRanges)) {
      await ctx.db.delete(record._id);
    }
  }
}

async function insertAllowedTimeRanges(
  ctx: MutationLikeCtx,
  args: {
    meetingId: Id<"meetings">;
    ranges: {
      startUtc: string;
      endUtc: string;
      timeZone: string;
      label?: string;
    }[];
    createdByMembershipId?: Id<"memberships">;
    now: number;
  },
) {
  for (const range of args.ranges) {
    await ctx.db.insert("allowedTimeRanges", {
      meetingId: args.meetingId,
      startUtc: range.startUtc,
      endUtc: range.endUtc,
      timeZone: range.timeZone,
      label: range.label,
      createdByMembershipId: args.createdByMembershipId,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
}

async function insertAuditEvent(
  ctx: MutationLikeCtx,
  args: {
    meetingId: Id<"meetings">;
    actorMembershipId?: Id<"memberships">;
    targetMembershipId?: Id<"memberships">;
    kind: string;
    metadata: Record<string, string | number | boolean | null>;
    now: number;
  },
) {
  await ctx.db.insert("auditEvents", {
    meetingId: args.meetingId,
    actorMembershipId: args.actorMembershipId,
    targetMembershipId: args.targetMembershipId,
    kind: args.kind,
    metadata: args.metadata,
    createdAt: args.now,
  });
}

function redactMembership(membership: {
  _id: Id<"memberships">;
  meetingId: Id<"meetings">;
  emailIdentityId?: Id<"emailIdentities">;
  displayName?: string;
  role: MembershipRole;
  privacyMode: PrivacyMode;
  tokenFingerprint: string;
  tokenVersion: number;
  tokenCreatedAt: number;
  tokenLastUsedAt?: number;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    _id: membership._id,
    meetingId: membership.meetingId,
    emailIdentityId: membership.emailIdentityId,
    displayName: membership.displayName,
    role: membership.role,
    privacyMode: membership.privacyMode,
    tokenFingerprint: membership.tokenFingerprint,
    tokenVersion: membership.tokenVersion,
    tokenCreatedAt: membership.tokenCreatedAt,
    tokenLastUsedAt: membership.tokenLastUsedAt,
    revokedAt: membership.revokedAt,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

type QueryLikeCtx = QueryCtx;
type MutationLikeCtx = MutationCtx;
