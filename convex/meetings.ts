import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAvailabilityCellAlignment,
  assertAvailabilityCellDuration,
  assertCanAdminister,
  assertCanEditOpenMeeting,
  buildGeneratedMeetingSlug,
  getMembershipCapabilities,
  isSlotInsideAllowedRanges,
  makeAvailabilityCellKey,
  normalizeEmailAddress,
  normalizeFinalizedSlot,
  normalizeAvailabilityNote,
  normalizeMeetingDescription,
  normalizeMeetingSettings,
  normalizeMeetingTitle,
  normalizeParticipantDisplayName,
  slugifyMeetingTitle,
  transitionMeetingLifecycle,
} from "./domain/model";
import type { MembershipRole, PrivacyMode } from "./domain/model";
import {
  assertCanAttachEmailIdentityToMembership,
  assertMagicLinkCanBeConsumed,
  assertVerifiedEmailIdentity,
  isMembershipRecoverable,
  normalizeMagicLinkExpiry,
} from "./domain/identity";
import {
  buildFinalizeMeetingPatch,
  buildLifecycleNotificationPlaceholders,
  buildReopenMeetingPatch,
  shouldAttemptNotificationDelivery,
} from "./domain/finalization";
import {
  createSecretToken,
  hashSecretToken,
  tokenFingerprintFromHash,
} from "./domain/tokens";
import { assertConvexRateLimit } from "./rateLimit";
import {
  buildMeetingResults,
  canViewerReadDetailedResults,
  type ResultParticipant,
} from "./domain/results";
import {
  adminModeValidator,
  availabilityResponseValidator,
  finalizedSlotValidator,
  membershipRoleValidator,
  privacyModeValidator,
} from "./domain/validators";
import {
  MAX_AVAILABILITY_BATCH_SIZE,
  MAX_AVAILABILITY_RECORDS,
  MAX_MEETING_MEMBERSHIPS,
} from "./domain/limits";

const INTERNAL_IDENTITY_SECRET_ENV = "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET";
const DEV_INTERNAL_IDENTITY_SECRET =
  "dev-only-meeting-scheduler-identity-internal-secret";
const EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const NOTIFICATION_DELIVERY_LEASE_MS = 15 * 60 * 1000;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AVAILABILITY_PRUNE_BATCH_SIZE = 200;
const MAX_DASHBOARD_MEMBERSHIPS = 200;
const MAX_VERIFIED_EMAILS = 20;

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

export const ensureUser = mutation({
  args: {
    internalSecret: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = Date.now();
    if (args.userId) {
      const existingUser = await ctx.db.get(args.userId);
      if (existingUser) {
        await ctx.db.patch(existingUser._id, {
          lastSeenAt: now,
          updatedAt: now,
        });
        return { userId: existingUser._id, created: false };
      }
    }

    const userId = await ctx.db.insert("users", {
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });
    return { userId, created: true };
  },
});

export const readUserSession = query({
  args: {
    internalSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { status: "stale" as const };
    }

    const verifiedEmails = await listVerifiedEmailsForUser(ctx, user._id);
    return {
      status: "active" as const,
      userId: user._id,
      verifiedEmails,
    };
  },
});

export const attachMembershipTokensToUser = mutation({
  args: {
    internalSecret: v.string(),
    userId: v.id("users"),
    membershipTokens: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User session is stale");
    }

    const now = Date.now();
    const importedMembershipIds: Id<"memberships">[] = [];
    const ignoredTokenFingerprints: string[] = [];
    const uniqueTokens = Array.from(
      new Set(args.membershipTokens.map((token) => token.trim()).filter(Boolean)),
    ).slice(0, 50);

    for (const membershipToken of uniqueTokens) {
      const tokenHash = await hashSecretToken(membershipToken);
      const tokenFingerprint = tokenFingerprintFromHash(tokenHash);
      const resolved = await resolveMembershipByTokenHash(ctx, tokenHash);
      if (!resolved) {
        ignoredTokenFingerprints.push(tokenFingerprint);
        continue;
      }

      const { membership, accessTokenId } = resolved;
      if (membership.userId !== user._id) {
        await ctx.db.patch(membership._id, {
          userId: user._id,
          tokenLastUsedAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(membership._id, {
          tokenLastUsedAt: now,
          updatedAt: now,
        });
      }
      if (accessTokenId) {
        await ctx.db.patch(accessTokenId, {
          tokenLastUsedAt: now,
          updatedAt: now,
        });
      }
      importedMembershipIds.push(membership._id);
    }

    await ctx.db.patch(user._id, {
      lastSeenAt: now,
      updatedAt: now,
    });
    return {
      userId: user._id,
      importedMembershipIds,
      ignoredTokenFingerprints,
    };
  },
});

export const createMeeting = mutation({
  args: {
    title: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    creatorName: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    clientRateLimitKey: v.optional(v.string()),
    creatorPrivacyMode: v.optional(privacyModeValidator),
    adminMode: v.optional(adminModeValidator),
    settings: v.optional(v.object(meetingSettingsArgs)),
    internalSecret: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await resolveTrustedUserId(ctx, {
      internalSecret: args.internalSecret,
      userId: args.userId,
      now,
    });
    const title = normalizeMeetingTitle(args.title);
    const settings = normalizeMeetingSettings(args.settings);
    await assertConvexRateLimit(ctx, {
      scope: "meeting.create",
      key: args.creatorEmail
        ? normalizeEmailAddress(args.creatorEmail)
        : slugifyMeetingTitle(args.slug ?? title),
      limit: 8,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    if (args.clientRateLimitKey) {
      await assertConvexRateLimit(ctx, {
        scope: "meeting.create.client",
        key: args.clientRateLimitKey,
        limit: 8,
        windowMs: RATE_LIMIT_WINDOW_MS,
        now,
      });
    }
    if (settings.allowedTimeRanges.length === 0) {
      throw new Error("Meeting creation requires at least one allowed time range");
    }

    const adminToken = await createSecretToken("membership");
    const slug =
      args.slug === undefined
        ? buildGeneratedMeetingSlug({
            title,
            tokenFingerprint: adminToken.tokenFingerprint,
          })
        : slugifyMeetingTitle(args.slug);

    const existingMeeting = await ctx.db
      .query("meetings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existingMeeting) {
      throw new Error("A meeting with this slug already exists");
    }

    const emailIdentityId = args.creatorEmail
      ? await upsertEmailIdentity(ctx, args.creatorEmail, args.creatorName, now, userId)
      : undefined;

    const meetingId = await ctx.db.insert("meetings", {
      title,
      slug,
      description: normalizeMeetingDescription(args.description),
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
      userId,
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

export const readPublicMeetingBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await findMeetingBySlug(ctx, args.slug);
    if (!meeting) {
      return null;
    }

    const results = await buildResultsForMeeting(ctx, meeting, null);

    return {
      meeting: redactPublicMeeting(meeting),
      capabilities: getMembershipCapabilities(meeting, null),
      results,
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

    const results = await buildResultsForMeeting(ctx, meeting, membership);

    return {
      meeting,
      membership: redactMembership(membership),
      capabilities: getMembershipCapabilities(meeting, membership),
      results,
    };
  },
});

export const readParticipantMeetingByMembershipToken = query({
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

    const ownAvailabilityRecords = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_membership", (q) => q.eq("membershipId", membership._id))
      .collect();

    const results = await buildResultsForMeeting(ctx, meeting, membership);

    return {
      meeting: redactPublicMeeting(meeting),
      membership: redactParticipantMembership(membership),
      capabilities: getMembershipCapabilities(meeting, membership),
      ownAvailabilityRecords,
      results,
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
    clientRateLimitKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const meeting = await findMeetingBySlug(ctx, args.meetingSlug);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    await assertConvexRateLimit(ctx, {
      scope: "membership.create",
      key: meeting.slug,
      limit: 300,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    if (args.clientRateLimitKey) {
      await assertConvexRateLimit(ctx, {
        scope: "membership.create.client",
        key: `${meeting.slug}:${args.clientRateLimitKey}`,
        limit: 60,
        windowMs: RATE_LIMIT_WINDOW_MS,
        now,
      });
    }

    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }

    const requestedRole: MembershipRole = args.role ?? "member";
    await assertMeetingMembershipCapacity(ctx, meeting._id);
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

export const createParticipantMembership = mutation({
  args: {
    meetingSlug: v.string(),
    displayName: v.string(),
    privacyMode: v.optional(privacyModeValidator),
    clientRateLimitKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const meeting = await findMeetingBySlug(ctx, args.meetingSlug);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    await assertConvexRateLimit(ctx, {
      scope: "membership.public_create",
      key: meeting.slug,
      limit: 300,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    if (args.clientRateLimitKey) {
      await assertConvexRateLimit(ctx, {
        scope: "membership.public_create.client",
        key: `${meeting.slug}:${args.clientRateLimitKey}`,
        limit: 60,
        windowMs: RATE_LIMIT_WINDOW_MS,
        now,
      });
    }

    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }

    const displayName = normalizeParticipantDisplayName(args.displayName);
    await assertMeetingMembershipCapacity(ctx, meeting._id);
    const membershipToken = await createSecretToken("membership");
    const membershipId = await ctx.db.insert("memberships", {
      meetingId: meeting._id,
      displayName,
      role: "member",
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
      targetMembershipId: membershipId,
      kind: "membership.created",
      metadata: { role: "member" },
      now,
    });

    return {
      meetingId: meeting._id,
      membershipId,
      membershipToken: membershipToken.rawToken,
    };
  },
});

export const createAdminInviteToken = mutation({
  args: {
    membershipToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    const meeting = await requireMeeting(ctx, membership.meetingId);
    assertCanAdminister(meeting, membership);
    if (meeting.adminMode === "everyoneAdmin") {
      throw new Error("This meeting does not need a separate admin invite link");
    }

    await assertConvexRateLimit(ctx, {
      scope: "admin_invite.create",
      key: membership._id,
      limit: 30,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });

    const adminInviteToken = await createSecretToken("adminInvite");
    await ctx.db.insert("adminInviteTokens", {
      meetingId: meeting._id,
      createdByMembershipId: membership._id,
      tokenHash: adminInviteToken.tokenHash,
      tokenFingerprint: adminInviteToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      expiresAt: now + ADMIN_INVITE_TOKEN_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "adminInvite.created",
      metadata: { tokenFingerprint: adminInviteToken.tokenFingerprint },
      now,
    });

    return {
      adminInviteToken: adminInviteToken.rawToken,
      tokenFingerprint: adminInviteToken.tokenFingerprint,
    };
  },
});

export const createAdminMembershipFromInvite = mutation({
  args: {
    meetingSlug: v.string(),
    adminInviteToken: v.string(),
    displayName: v.string(),
    privacyMode: v.optional(privacyModeValidator),
    clientRateLimitKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const meeting = await findMeetingBySlug(ctx, args.meetingSlug);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    await assertConvexRateLimit(ctx, {
      scope: "membership.admin_invite_create",
      key: meeting.slug,
      limit: 300,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    if (args.clientRateLimitKey) {
      await assertConvexRateLimit(ctx, {
        scope: "membership.admin_invite_create.client",
        key: `${meeting.slug}:${args.clientRateLimitKey}`,
        limit: 60,
        windowMs: RATE_LIMIT_WINDOW_MS,
        now,
      });
    }

    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    if (meeting.adminMode === "everyoneAdmin") {
      throw new Error("This meeting does not require an admin invite");
    }

    const adminInvite = await requireAdminInviteToken(ctx, args.adminInviteToken, now);
    if (adminInvite.meetingId !== meeting._id) {
      throw new Error("Admin invite does not belong to this meeting");
    }

    const creator = await ctx.db.get(adminInvite.createdByMembershipId);
    if (!creator || creator.meetingId !== meeting._id) {
      throw new Error("Admin invite creator is unavailable");
    }
    assertCanAdminister(meeting, creator);

    const displayName = normalizeParticipantDisplayName(args.displayName);
    await assertMeetingMembershipCapacity(ctx, meeting._id);
    const membershipToken = await createSecretToken("membership");
    const membershipId = await ctx.db.insert("memberships", {
      meetingId: meeting._id,
      displayName,
      role: "admin",
      privacyMode: args.privacyMode ?? "detailed",
      tokenHash: membershipToken.tokenHash,
      tokenFingerprint: membershipToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(adminInvite._id, {
      tokenLastUsedAt: now,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: creator._id,
      targetMembershipId: membershipId,
      kind: "membership.created",
      metadata: {
        role: "admin",
        adminInviteFingerprint: adminInvite.tokenFingerprint,
      },
      now,
    });

    return {
      meetingId: meeting._id,
      membershipId,
      membershipToken: membershipToken.rawToken,
    };
  },
});

export const updateMembershipDisplayName = mutation({
  args: {
    membershipToken: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    await assertConvexRateLimit(ctx, {
      scope: "membership.update_name",
      key: membership._id,
      limit: 30,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    const meeting = await requireMeeting(ctx, membership.meetingId);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    const displayName = normalizeParticipantDisplayName(args.displayName);

    await ctx.db.patch(membership._id, {
      displayName,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: membership.meetingId,
      actorMembershipId: membership._id,
      targetMembershipId: membership._id,
      kind: "membership.display_name_updated",
      metadata: {},
      now,
    });

    return { membershipId: membership._id, displayName };
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
    await assertConvexRateLimit(ctx, {
      scope: "meeting.update_settings",
      key: membership._id,
      limit: 30,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
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
      ...(args.title !== undefined ? { title: normalizeMeetingTitle(args.title) } : {}),
      ...(args.description !== undefined
        ? { description: normalizeMeetingDescription(args.description) }
        : {}),
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

export const pruneAvailabilityOutsideRangesBatch = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      return null;
    }
    const page = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: AVAILABILITY_PRUNE_BATCH_SIZE,
      });
    for (const record of page.page) {
      if (!isSlotInsideAllowedRanges(record, meeting.allowedTimeRanges)) {
        await ctx.db.delete(record._id);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.meetings.pruneAvailabilityOutsideRangesBatch,
        {
          meetingId: meeting._id,
          cursor: page.continueCursor,
        },
      );
    }
    return null;
  },
});

export const finalizeMeeting = mutation({
  args: {
    membershipToken: v.string(),
    finalizedSlot: finalizedSlotValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    await assertConvexRateLimit(ctx, {
      scope: "meeting.finalize",
      key: membership._id,
      limit: 20,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    const meeting = await requireMeeting(ctx, membership.meetingId);
    const nextLifecycleState = transitionMeetingLifecycle(
      meeting,
      membership,
      "finalize",
    );
    const finalizedSlot = normalizeFinalizedSlot(args.finalizedSlot, meeting);
    const meetingPatch = buildFinalizeMeetingPatch({
      lifecycleRevision: meeting.lifecycleRevision,
      finalizedAt: now,
      finalizedByMembershipId: membership._id,
      finalizedSlot,
    });

    await ctx.db.patch(meeting._id, {
      ...meetingPatch,
      lifecycleState: nextLifecycleState,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "meeting.finalized",
      metadata: {
        startUtc: finalizedSlot.startUtc,
        endUtc: finalizedSlot.endUtc,
        timeZone: finalizedSlot.timeZone,
      },
      now,
    });
    await insertNotificationPlaceholdersForMeeting(ctx, {
      meetingId: meeting._id,
      kind: "meeting.finalized",
      lifecycleRevision: meetingPatch.lifecycleRevision,
      payload: {
        startUtc: finalizedSlot.startUtc,
        endUtc: finalizedSlot.endUtc,
        timeZone: finalizedSlot.timeZone,
      },
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
    await assertConvexRateLimit(ctx, {
      scope: "meeting.reopen",
      key: membership._id,
      limit: 20,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    const meeting = await requireMeeting(ctx, membership.meetingId);
    const nextLifecycleState = transitionMeetingLifecycle(meeting, membership, "reopen");
    const meetingPatch = buildReopenMeetingPatch({
      lifecycleRevision: meeting.lifecycleRevision,
      reopenedAt: now,
      reopenedByMembershipId: membership._id,
    });

    await ctx.db.patch(meeting._id, {
      ...meetingPatch,
      lifecycleState: nextLifecycleState,
    });

    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      kind: "meeting.reopened",
      metadata: {},
      now,
    });
    await insertNotificationPlaceholdersForMeeting(ctx, {
      meetingId: meeting._id,
      kind: "meeting.reopened",
      lifecycleRevision: meetingPatch.lifecycleRevision,
      payload: {},
      now,
    });

    return { meetingId: meeting._id, lifecycleState: nextLifecycleState };
  },
});

export const requestEmailVerificationForDelivery = mutation({
  args: {
    internalSecret: v.string(),
    email: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    return await createEmailVerificationMagicLink(ctx, {
      email: args.email,
      displayName: args.displayName,
      exposeRawToken: true,
      queueForDelivery: true,
    });
  },
});

export const listQueuedEmailNotifications = query({
  args: {
    internalSecret: v.string(),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const statuses = ["queued", "pending", "failed", "sending"] as const;
    const notificationIds: Id<"notificationOutbox">[] = [];

    for (const status of statuses) {
      if (notificationIds.length >= limit) {
        break;
      }
      const notifications = await ctx.db
        .query("notificationOutbox")
        .withIndex("by_status_updated", (q) => q.eq("status", status))
        .take(Math.max(limit * 4, 50));
      for (const notification of notifications) {
        if (
          notificationIds.length < limit &&
          notification.kind.startsWith("meeting.") &&
          shouldAttemptNotificationDelivery({
            status: notification.status,
            scheduledFor: notification.scheduledFor,
            attempts: notification.attempts,
            now,
            maxAttempts: MAX_NOTIFICATION_ATTEMPTS,
          })
        ) {
          notificationIds.push(notification._id);
        }
      }
    }

    return { notificationIds };
  },
});

export const claimNotificationForDelivery = mutation({
  args: {
    internalSecret: v.string(),
    notificationId: v.id("notificationOutbox"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return { status: "skipped" as const, reason: "not_found" };
    }
    if (
      !shouldAttemptNotificationDelivery({
        status: notification.status,
        scheduledFor: notification.scheduledFor,
        attempts: notification.attempts,
        now,
        maxAttempts: MAX_NOTIFICATION_ATTEMPTS,
      })
    ) {
      return { status: "skipped" as const, reason: "not_due" };
    }
    if (
      notification.kind !== "meeting.finalized" &&
      notification.kind !== "meeting.reopened"
    ) {
      return { status: "skipped" as const, reason: "unsupported_kind" };
    }
    if (
      !notification.meetingId ||
      !notification.membershipId ||
      !notification.emailIdentityId
    ) {
      await ctx.db.patch(notification._id, {
        status: "cancelled",
        lastError: "Notification is missing recipient context",
        updatedAt: now,
      });
      return { status: "cancelled" as const, reason: "missing_context" };
    }

    const [meeting, membership, identity] = await Promise.all([
      ctx.db.get(notification.meetingId),
      ctx.db.get(notification.membershipId),
      ctx.db.get(notification.emailIdentityId),
    ]);
    if (
      !meeting ||
      !membership ||
      membership.revokedAt !== undefined ||
      membership.meetingId !== notification.meetingId ||
      membership.emailIdentityId !== notification.emailIdentityId ||
      !identity?.verifiedAt
    ) {
      await ctx.db.patch(notification._id, {
        status: "cancelled",
        lastError: "Recipient is no longer verified and attached",
        updatedAt: now,
      });
      return { status: "cancelled" as const, reason: "invalid_recipient" };
    }

    const attempts = notification.attempts + 1;
    await ctx.db.patch(notification._id, {
      status: "sending",
      attempts,
      scheduledFor: now + NOTIFICATION_DELIVERY_LEASE_MS,
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      notification: {
        _id: notification._id,
        kind: notification.kind,
        dedupeKey: notification.dedupeKey,
        payload: notification.payload,
        attempts,
      },
      meeting: {
        title: meeting.title,
        slug: meeting.slug,
      },
      recipient: {
        normalizedEmail: identity.normalizedEmail,
      },
    };
  },
});

export const markNotificationSent = mutation({
  args: {
    internalSecret: v.string(),
    notificationId: v.id("notificationOutbox"),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return { status: "skipped" as const };
    }
    if (notification.status === "sent") {
      return { status: "sent" as const };
    }
    await ctx.db.patch(notification._id, {
      status: "sent",
      provider: args.provider,
      providerMessageId: args.providerMessageId,
      sentAt: now,
      scheduledFor: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    return { status: "sent" as const };
  },
});

export const markNotificationFailed = mutation({
  args: {
    internalSecret: v.string(),
    notificationId: v.id("notificationOutbox"),
    error: v.string(),
    retryAt: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = args.now ?? Date.now();
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return { status: "skipped" as const };
    }
    if (notification.status === "sent") {
      return { status: "sent" as const };
    }
    await ctx.db.patch(notification._id, {
      status: "failed",
      lastError: args.error,
      scheduledFor: args.retryAt,
      updatedAt: now,
    });
    return { status: "failed" as const };
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
    await assertConvexRateLimit(ctx, {
      scope: "availability.single_save",
      key: membership._id,
      limit: 180,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    const meeting = await requireMeeting(ctx, membership.meetingId);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    assertMembershipHasDisplayName(membership);

    assertAvailabilityCellAlignment(
      args.startUtc,
      args.endUtc,
      meeting.granularityMinutes,
      meeting.canonicalTimeZone,
    );
    assertAvailabilityCellDuration(
      args.startUtc,
      args.endUtc,
      meeting.granularityMinutes,
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
      timeZone: meeting.canonicalTimeZone,
      cellKey,
      response: args.response,
      note: normalizeAvailabilityNote(args.note),
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

export const saveAvailabilityRecords = mutation({
  args: {
    membershipToken: v.string(),
    records: v.array(
      v.object({
        startUtc: v.string(),
        endUtc: v.string(),
        timeZone: v.optional(v.string()),
        response: v.optional(availabilityResponseValidator),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.records.length > MAX_AVAILABILITY_BATCH_SIZE) {
      throw new Error(
        `Availability batches must contain at most ${MAX_AVAILABILITY_BATCH_SIZE} records`,
      );
    }
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    await assertConvexRateLimit(ctx, {
      scope: "availability.batch_save",
      key: membership._id,
      limit: 120,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const meeting = await requireMeeting(ctx, membership.meetingId);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    assertMembershipHasDisplayName(membership);

    const savedRecordIds: Id<"availabilityRecords">[] = [];
    const clearedCellKeys: string[] = [];
    const uniqueRecords = dedupeAvailabilityRecordBatch(args.records);
    for (const record of uniqueRecords) {
      const result = await saveAvailabilityRecord(ctx, {
        membershipId: membership._id,
        meeting,
        record,
      });
      if (result.kind === "saved") {
        savedRecordIds.push(result.availabilityRecordId);
      } else {
        clearedCellKeys.push(result.cellKey);
      }
    }

    return { savedRecordIds, clearedCellKeys };
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
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .take(MAX_MEETING_MEMBERSHIPS + 1);
    if (memberships.length > MAX_MEETING_MEMBERSHIPS) {
      throw new Error(`Meeting exceeds the ${MAX_MEETING_MEMBERSHIPS}-member limit`);
    }
    const participants: ResultParticipant[] = memberships.map((candidate) => ({
      membershipId: candidate._id,
      displayName: candidate.displayName,
      role: candidate.role,
      privacyMode: candidate.privacyMode,
      revokedAt: candidate.revokedAt,
    }));
    const includeAllRecords = canViewerReadDetailedResults({
      viewer:
        participants.find((candidate) => candidate.membershipId === membership._id) ??
        null,
      participants,
      canAdminister: getMembershipCapabilities(meeting, membership).canAdminister,
    });
    const activeMembershipIds = new Set(
      participants
        .filter((candidate) => candidate.revokedAt === undefined)
        .map((candidate) => candidate.membershipId),
    );
    const records = await ctx.db
      .query("availabilityRecords")
      .withIndex(includeAllRecords ? "by_meeting" : "by_membership", (q) =>
        includeAllRecords
          ? q.eq("meetingId", meeting._id)
          : q.eq("membershipId", membership._id),
      )
      .take(MAX_AVAILABILITY_RECORDS + 1);
    if (records.length > MAX_AVAILABILITY_RECORDS) {
      throw new Error("Meeting has too many availability records");
    }

    return {
      meetingId: meeting._id,
      requestingMembership: redactMembership(membership),
      visibility: includeAllRecords ? "detailed" : "ownOnly",
      records: includeAllRecords
        ? records.filter((record) => activeMembershipIds.has(record.membershipId))
        : records,
    };
  },
});

export const completeEmailVerificationForUser = mutation({
  args: {
    internalSecret: v.string(),
    magicLinkToken: v.string(),
    currentUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    return await completeEmailVerificationForUserId(ctx, {
      magicLinkToken: args.magicLinkToken,
      currentUserId: args.currentUserId,
    });
  },
});

export const attachVerifiedEmailIdentityToMembership = mutation({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
    membershipToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = Date.now();
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);
    const membershipTokenHash = await hashSecretToken(args.membershipToken);
    await assertConvexRateLimit(ctx, {
      scope: "membership.attach_email",
      key: `${args.emailIdentityId}:${tokenFingerprintFromHash(membershipTokenHash)}`,
      limit: 20,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });

    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    assertCanAttachEmailIdentityToMembership({
      membership: {
        emailIdentityId: membership.emailIdentityId,
      },
      emailIdentityId: args.emailIdentityId,
    });

    await ctx.db.patch(membership._id, {
      emailIdentityId: args.emailIdentityId,
      userId: identity.userId,
      updatedAt: now,
    });
    await insertAuditEvent(ctx, {
      meetingId: membership.meetingId,
      actorMembershipId: membership._id,
      targetMembershipId: membership._id,
      kind: "membership.email_identity_attached",
      metadata: {},
      now,
    });

    return {
      membershipId: membership._id,
      emailIdentityId: identity._id,
      normalizedEmail: identity.normalizedEmail,
    };
  },
});

export const listUserDashboard = query({
  args: {
    internalSecret: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User session is stale");
    }

    const verifiedEmails = await listVerifiedEmailsForUser(ctx, user._id);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_DASHBOARD_MEMBERSHIPS);
    const rows = await buildDashboardMembershipRows(ctx, memberships);

    return {
      user: {
        userId: user._id,
      },
      identity: {
        normalizedEmail:
          verifiedEmails.map((identity) => identity.normalizedEmail).join(", ") ||
          "this browser session",
      },
      verifiedEmails,
      memberships: rows
        .filter((row) => row.revokedAt === undefined)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((row) => ({
          membershipId: row._id,
          role: row.role,
          displayName: row.displayName,
          hasAvailability: row.hasAvailability,
          canRecover: isMembershipRecoverable({
            role: row.role,
            revokedAt: row.revokedAt,
            hasAvailability: row.hasAvailability,
          }),
          meeting: row.meeting,
        })),
    };
  },
});

export const readEmailIdentitySession = query({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const identity = await ctx.db.get(args.emailIdentityId);
    if (!identity?.verifiedAt) {
      return { status: "stale" as const };
    }

    return {
      status: "verified" as const,
      emailIdentityId: identity._id,
      normalizedEmail: identity.normalizedEmail,
      verifiedAt: identity.verifiedAt,
    };
  },
});

export const createRecoveredUserMembershipLink = mutation({
  args: {
    internalSecret: v.string(),
    userId: v.id("users"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = Date.now();
    await assertConvexRateLimit(ctx, {
      scope: "membership.user_recovery",
      key: args.userId,
      limit: 20,
      windowMs: RATE_LIMIT_WINDOW_MS,
      now,
    });
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User session is stale");
    }
    const membership = await ctx.db.get(args.membershipId);
    if (
      !membership ||
      membership.revokedAt !== undefined ||
      membership.userId !== user._id
    ) {
      throw new Error("Membership is not recoverable for this user");
    }
    const availability = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_membership", (q) => q.eq("membershipId", membership._id))
      .first();
    if (
      !isMembershipRecoverable({
        role: membership.role,
        revokedAt: membership.revokedAt,
        hasAvailability: Boolean(availability),
      })
    ) {
      throw new Error("Membership is not recoverable for this user");
    }

    const accessToken = await createSecretToken("membership");
    await ctx.db.insert("membershipAccessTokens", {
      membershipId: membership._id,
      tokenHash: accessToken.tokenHash,
      tokenFingerprint: accessToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await insertAuditEvent(ctx, {
      meetingId: membership.meetingId,
      actorMembershipId: membership._id,
      targetMembershipId: membership._id,
      kind: "membership.user_recovery_link_created",
      metadata: {
        tokenFingerprint: accessToken.tokenFingerprint,
      },
      now,
    });

    return {
      membershipId: membership._id,
      membershipToken: accessToken.rawToken,
      tokenFingerprint: accessToken.tokenFingerprint,
    };
  },
});

async function completeEmailVerificationForUserId(
  ctx: MutationLikeCtx,
  args: {
    magicLinkToken: string;
    currentUserId?: Id<"users">;
  },
) {
  const now = Date.now();
  const tokenHash = await hashSecretToken(args.magicLinkToken);
  await assertConvexRateLimit(ctx, {
    scope: "magic_link.verify",
    key: tokenFingerprintFromHash(tokenHash),
    limit: 10,
    windowMs: RATE_LIMIT_WINDOW_MS,
    now,
  });
  const magicLink = await ctx.db
    .query("magicLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  assertMagicLinkCanBeConsumed(magicLink, now);
  if (magicLink.purpose !== "emailVerification" || !magicLink.emailIdentityId) {
    throw new Error("Magic link cannot verify an email identity");
  }

  const identity = await ctx.db.get(magicLink.emailIdentityId);
  if (!identity) {
    throw new Error("Email identity not found");
  }

  let canonicalUserId = identity.userId;
  if (!canonicalUserId && args.currentUserId) {
    const currentUser = await ctx.db.get(args.currentUserId);
    if (!currentUser) {
      throw new Error("Current user session is stale");
    }
    canonicalUserId = currentUser._id;
  }
  if (!canonicalUserId) {
    canonicalUserId = await ctx.db.insert("users", {
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });
  }

  if (args.currentUserId && args.currentUserId !== canonicalUserId) {
    await mergeUsers(ctx, {
      sourceUserId: args.currentUserId,
      targetUserId: canonicalUserId,
      now,
    });
  }

  await ctx.db.patch(magicLink._id, { consumedAt: now });
  await ctx.db.patch(identity._id, {
    userId: canonicalUserId,
    verifiedAt: identity.verifiedAt ?? now,
    updatedAt: now,
  });
  await ctx.db.patch(canonicalUserId, {
    lastSeenAt: now,
    updatedAt: now,
  });

  return {
    userId: canonicalUserId,
    emailIdentityId: identity._id,
    normalizedEmail: identity.normalizedEmail,
    verifiedAt: identity.verifiedAt ?? now,
  };
}

async function mergeUsers(
  ctx: MutationLikeCtx,
  args: {
    sourceUserId: Id<"users">;
    targetUserId: Id<"users">;
    now: number;
  },
) {
  if (args.sourceUserId === args.targetUserId) {
    return;
  }
  const [sourceUser, targetUser] = await Promise.all([
    ctx.db.get(args.sourceUserId),
    ctx.db.get(args.targetUserId),
  ]);
  if (!sourceUser || !targetUser) {
    throw new Error("User merge target is stale");
  }

  const sourceEmails = await ctx.db
    .query("emailIdentities")
    .withIndex("by_user", (q) => q.eq("userId", sourceUser._id))
    .collect();
  for (const email of sourceEmails) {
    await ctx.db.patch(email._id, {
      userId: targetUser._id,
      updatedAt: args.now,
    });
  }

  const targetMemberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", targetUser._id))
    .collect();
  const targetMeetingIds = new Set(
    targetMemberships.map((membership) => membership.meetingId),
  );
  const sourceMemberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", sourceUser._id))
    .collect();

  for (const membership of sourceMemberships) {
    await ctx.db.patch(membership._id, {
      userId: targetMeetingIds.has(membership.meetingId) ? undefined : targetUser._id,
      updatedAt: args.now,
    });
  }

  await ctx.db.patch(targetUser._id, {
    lastSeenAt: args.now,
    updatedAt: args.now,
  });
  await ctx.db.delete(sourceUser._id);
}

async function listVerifiedEmailsForUser(ctx: QueryLikeCtx, userId: Id<"users">) {
  const identities = await ctx.db
    .query("emailIdentities")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_VERIFIED_EMAILS);
  return identities
    .filter((identity) => identity.verifiedAt !== undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((identity) => ({
      emailIdentityId: identity._id,
      normalizedEmail: identity.normalizedEmail,
      verifiedAt: identity.verifiedAt,
    }));
}

async function buildDashboardMembershipRows(
  ctx: QueryLikeCtx,
  memberships: {
    _id: Id<"memberships">;
    meetingId: Id<"meetings">;
    role: MembershipRole;
    displayName?: string;
    revokedAt?: number;
    updatedAt: number;
  }[],
) {
  const rows: {
    _id: Id<"memberships">;
    meetingId: Id<"meetings">;
    role: MembershipRole;
    displayName?: string;
    revokedAt?: number;
    updatedAt: number;
    hasAvailability: boolean;
    meeting: ReturnType<typeof redactPublicMeeting>;
  }[] = [];
  for (const membership of memberships) {
    const meeting = await ctx.db.get(membership.meetingId);
    if (!meeting) {
      continue;
    }
    const availability = await ctx.db
      .query("availabilityRecords")
      .withIndex("by_membership", (q) => q.eq("membershipId", membership._id))
      .first();
    rows.push({
      _id: membership._id,
      meetingId: membership.meetingId,
      role: membership.role,
      displayName: membership.displayName,
      revokedAt: membership.revokedAt,
      updatedAt: membership.updatedAt,
      hasAvailability: Boolean(availability),
      meeting: redactPublicMeeting(meeting),
    });
  }
  return rows;
}

async function buildResultsForMeeting(
  ctx: QueryLikeCtx,
  meeting: {
    _id: Id<"meetings">;
    adminMode: "roleBased" | "everyoneAdmin";
    lifecycleState: "open" | "finalized";
    canonicalTimeZone: string;
    granularityMinutes: number;
    durationMinutes: number;
    allowedTimeRanges: {
      startUtc: string;
      endUtc: string;
      timeZone: string;
      label?: string;
    }[];
    updatedAt: number;
  },
  viewer: {
    _id: Id<"memberships">;
    displayName?: string;
    role: MembershipRole;
    privacyMode: PrivacyMode;
    revokedAt?: number;
    updatedAt: number;
  } | null,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .take(MAX_MEETING_MEMBERSHIPS + 1);
  if (memberships.length > MAX_MEETING_MEMBERSHIPS) {
    throw new Error(`Meeting exceeds the ${MAX_MEETING_MEMBERSHIPS}-member limit`);
  }
  const availabilityRecords = await ctx.db
    .query("availabilityRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .take(MAX_AVAILABILITY_RECORDS + 1);
  if (availabilityRecords.length > MAX_AVAILABILITY_RECORDS) {
    throw new Error("Meeting has too many availability records to calculate results");
  }
  const participants: ResultParticipant[] = memberships.map((membership) => ({
    membershipId: membership._id,
    displayName: membership.displayName,
    role: membership.role,
    privacyMode: membership.privacyMode,
    revokedAt: membership.revokedAt,
  }));
  const viewerParticipant = viewer
    ? participants.find((participant) => participant.membershipId === viewer._id)
    : null;
  const includeDetails = canViewerReadDetailedResults({
    viewer: viewerParticipant,
    participants,
    canAdminister: getMembershipCapabilities(meeting, viewer).canAdminister,
  });
  const generatedAt = Math.max(
    meeting.updatedAt,
    ...memberships.map((membership) => membership.updatedAt),
    ...availabilityRecords.map((record) => record.updatedAt),
  );

  return buildMeetingResults({
    allowedTimeRanges: meeting.allowedTimeRanges,
    participants,
    availabilityRecords: availabilityRecords.map((record) => ({
      membershipId: record.membershipId,
      cellKey: record.cellKey,
      response: record.response,
    })),
    granularityMinutes: meeting.granularityMinutes,
    durationMinutes: meeting.durationMinutes,
    timeZone: meeting.canonicalTimeZone,
    generatedAt,
    includeDetails,
  });
}

async function findMeetingBySlug(ctx: QueryLikeCtx, meetingSlug: string) {
  const exactMeeting = await ctx.db
    .query("meetings")
    .withIndex("by_slug", (q) => q.eq("slug", meetingSlug))
    .unique();
  if (exactMeeting) {
    return exactMeeting;
  }

  const normalizedSlug = slugifyMeetingTitle(meetingSlug);
  if (normalizedSlug === meetingSlug) {
    return null;
  }

  return await ctx.db
    .query("meetings")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
    .unique();
}

async function findMembershipByToken(ctx: QueryLikeCtx, membershipToken: string) {
  const resolved = await resolveMembershipByToken(ctx, membershipToken);
  return resolved?.membership ?? null;
}

async function resolveMembershipByToken(ctx: QueryLikeCtx, membershipToken: string) {
  const tokenHash = await hashSecretToken(membershipToken);
  return await resolveMembershipByTokenHash(ctx, tokenHash);
}

async function resolveMembershipByTokenHash(ctx: QueryLikeCtx, tokenHash: string) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();

  if (membership) {
    if (membership.revokedAt !== undefined) {
      return null;
    }
    return { membership, accessTokenId: undefined };
  }

  const accessToken = await ctx.db
    .query("membershipAccessTokens")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!accessToken || accessToken.revokedAt !== undefined) {
    return null;
  }

  const accessMembership = await ctx.db.get(accessToken.membershipId);
  if (!accessMembership || accessMembership.revokedAt !== undefined) {
    return null;
  }

  return { membership: accessMembership, accessTokenId: accessToken._id };
}

async function resolveTrustedUserId(
  ctx: MutationLikeCtx,
  args: {
    internalSecret?: string;
    userId?: Id<"users">;
    now: number;
  },
) {
  if (!args.userId) {
    return undefined;
  }
  if (!args.internalSecret) {
    throw new Error("Internal identity authorization failed");
  }
  assertInternalIdentitySecret(args.internalSecret);
  const user = await ctx.db.get(args.userId);
  if (!user) {
    throw new Error("User session is stale");
  }
  await ctx.db.patch(user._id, {
    lastSeenAt: args.now,
    updatedAt: args.now,
  });
  return user._id;
}

async function requireMembershipByToken(ctx: MutationLikeCtx, membershipToken: string) {
  const resolved = await resolveMembershipByToken(ctx, membershipToken);
  if (!resolved) {
    throw new Error("Membership token is invalid");
  }

  const now = Date.now();
  const { membership, accessTokenId } = resolved;
  await ctx.db.patch(membership._id, {
    tokenLastUsedAt: now,
    updatedAt: now,
  });
  if (accessTokenId) {
    await ctx.db.patch(accessTokenId, {
      tokenLastUsedAt: now,
      updatedAt: now,
    });
  }
  return membership;
}

async function requireAdminInviteToken(
  ctx: MutationLikeCtx,
  adminInviteToken: string,
  now: number,
) {
  const tokenHash = await hashSecretToken(adminInviteToken);
  const adminInvite = await ctx.db
    .query("adminInviteTokens")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!adminInvite || adminInvite.revokedAt !== undefined) {
    throw new Error("Admin invite link is invalid or revoked");
  }
  if (adminInvite.expiresAt <= now) {
    throw new Error("Admin invite link is expired");
  }
  return adminInvite;
}

async function requireMeeting(ctx: QueryLikeCtx, meetingId: Id<"meetings">) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) {
    throw new Error("Meeting not found");
  }
  return meeting;
}

async function assertMeetingMembershipCapacity(
  ctx: QueryLikeCtx,
  meetingId: Id<"meetings">,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .take(MAX_MEETING_MEMBERSHIPS);
  if (memberships.length >= MAX_MEETING_MEMBERSHIPS) {
    throw new Error(`Meeting supports at most ${MAX_MEETING_MEMBERSHIPS} memberships`);
  }
}

async function upsertEmailIdentity(
  ctx: MutationLikeCtx,
  email: string,
  displayName: string | undefined,
  now: number,
  userId?: Id<"users">,
) {
  const normalizedEmail = normalizeEmailAddress(email);
  const existingIdentity = await ctx.db
    .query("emailIdentities")
    .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
    .unique();

  if (existingIdentity) {
    await ctx.db.patch(existingIdentity._id, {
      ...(userId && !existingIdentity.userId ? { userId } : {}),
      ...(displayName ? { displayName: displayName.trim() } : {}),
      updatedAt: now,
    });
    return existingIdentity._id;
  }

  return await ctx.db.insert("emailIdentities", {
    normalizedEmail,
    userId,
    displayName: displayName?.trim(),
    createdAt: now,
    updatedAt: now,
  });
}

async function assertEmailVerificationRequestAllowed(
  ctx: MutationLikeCtx,
  emailIdentityId: Id<"emailIdentities">,
  now: number,
) {
  const recentLinks = await ctx.db
    .query("magicLinks")
    .withIndex("by_email_identity", (q) => q.eq("emailIdentityId", emailIdentityId))
    .collect();
  const cooldownStartedAt = now - EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS;
  for (const link of recentLinks) {
    if (link.purpose !== "emailVerification" || link.createdAt <= cooldownStartedAt) {
      continue;
    }
    if (!(await wasMagicLinkDeliveryTerminallyFailed(ctx, link.tokenFingerprint))) {
      throw new Error("Please wait before requesting another verification link");
    }
  }
}

async function wasMagicLinkDeliveryTerminallyFailed(
  ctx: MutationLikeCtx,
  tokenFingerprint: string,
) {
  const notification = await ctx.db
    .query("notificationOutbox")
    .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", `magicLink:${tokenFingerprint}`))
    .unique();
  return notification?.status === "failed";
}

async function createEmailVerificationMagicLink(
  ctx: MutationLikeCtx,
  args: {
    email: string;
    displayName?: string;
    exposeRawToken?: boolean;
    queueForDelivery?: boolean;
  },
) {
  const now = Date.now();
  const expiresAt = normalizeMagicLinkExpiry({ now });
  const normalizedEmail = normalizeEmailAddress(args.email);
  await assertConvexRateLimit(ctx, {
    scope: "magic_link.email",
    key: normalizedEmail,
    limit: 3,
    windowMs: RATE_LIMIT_WINDOW_MS,
    now,
  });
  const emailIdentityId = await upsertEmailIdentity(
    ctx,
    args.email,
    args.displayName,
    now,
  );
  await assertEmailVerificationRequestAllowed(ctx, emailIdentityId, now);
  const magicLinkToken = await createSecretToken("magicLink");
  const magicLinkId = await ctx.db.insert("magicLinks", {
    purpose: "emailVerification",
    emailIdentityId,
    tokenHash: magicLinkToken.tokenHash,
    tokenFingerprint: magicLinkToken.tokenFingerprint,
    tokenVersion: 1,
    tokenCreatedAt: now,
    expiresAt,
    createdAt: now,
  });

  const deliveryQueued = args.queueForDelivery === true;
  const notificationOutboxId = await ctx.db.insert("notificationOutbox", {
    emailIdentityId,
    kind: "magicLink.emailVerification",
    status: deliveryQueued ? "queued" : "cancelled",
    dedupeKey: `magicLink:${magicLinkToken.tokenFingerprint}`,
    payload: {
      magicLinkId,
      tokenFingerprint: magicLinkToken.tokenFingerprint,
    },
    attempts: 0,
    lastError: deliveryQueued
      ? undefined
      : "Magic link delivery requires the server email adapter route",
    createdAt: now,
    updatedAt: now,
  });

  return {
    magicLinkId,
    notificationOutboxId,
    normalizedEmail,
    tokenFingerprint: magicLinkToken.tokenFingerprint,
    expiresAt,
    deliveryQueued,
    rawMagicLinkToken: args.exposeRawToken ? magicLinkToken.rawToken : undefined,
    devMagicLinkToken: shouldExposeDevMagicLinkToken()
      ? magicLinkToken.rawToken
      : undefined,
  };
}

function assertInternalIdentitySecret(providedSecret: string): void {
  const expectedSecret = process.env[INTERNAL_IDENTITY_SECRET_ENV];
  if (!expectedSecret) {
    if (
      isExplicitLocalDevelopmentRuntime() &&
      process.env.MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET === "true" &&
      constantTimeEqualString(providedSecret, DEV_INTERNAL_IDENTITY_SECRET)
    ) {
      return;
    }
    throw new Error(`${INTERNAL_IDENTITY_SECRET_ENV} is required`);
  }
  if (expectedSecret.length < 32) {
    throw new Error(`${INTERNAL_IDENTITY_SECRET_ENV} must be at least 32 characters`);
  }
  if (!constantTimeEqualString(providedSecret, expectedSecret)) {
    throw new Error("Internal identity authorization failed");
  }
}

function shouldExposeDevMagicLinkToken(): boolean {
  return (
    isExplicitLocalDevelopmentRuntime() &&
    process.env.MEETING_SCHEDULER_DEV_EXPOSE_MAGIC_LINKS === "true"
  );
}

function isExplicitLocalDevelopmentRuntime(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") === true
  );
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
  await ctx.scheduler.runAfter(0, internal.meetings.pruneAvailabilityOutsideRangesBatch, {
    meetingId: args.meetingId,
  });
}

function constantTimeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length, 1);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
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

async function insertNotificationPlaceholdersForMeeting(
  ctx: MutationLikeCtx,
  args: {
    meetingId: Id<"meetings">;
    kind: "meeting.finalized" | "meeting.reopened";
    lifecycleRevision: number;
    payload: Record<string, string | number | boolean | null>;
    now: number;
  },
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  const emailIdentityIds = Array.from(
    new Set(
      memberships
        .map((membership) => membership.emailIdentityId)
        .filter((emailIdentityId): emailIdentityId is Id<"emailIdentities"> =>
          Boolean(emailIdentityId),
        ),
    ),
  );
  const loadedEmailIdentities = await Promise.all(
    emailIdentityIds.map((emailIdentityId) => ctx.db.get(emailIdentityId)),
  );
  const emailIdentities = loadedEmailIdentities.filter(
    (identity): identity is NonNullable<(typeof loadedEmailIdentities)[number]> =>
      identity !== null,
  );
  const placeholders = buildLifecycleNotificationPlaceholders({
    meetingId: args.meetingId,
    memberships,
    emailIdentities,
    kind: args.kind,
    lifecycleRevision: args.lifecycleRevision,
    payload: args.payload,
    now: args.now,
  });

  for (const placeholder of placeholders) {
    if (placeholder.dedupeKey) {
      const existing = await ctx.db
        .query("notificationOutbox")
        .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", placeholder.dedupeKey))
        .unique();
      if (existing) {
        continue;
      }
    }
    await ctx.db.insert("notificationOutbox", placeholder);
  }
}

async function saveAvailabilityRecord(
  ctx: MutationLikeCtx,
  args: {
    membershipId: Id<"memberships">;
    meeting: {
      _id: Id<"meetings">;
      canonicalTimeZone: string;
      granularityMinutes: number;
      allowedTimeRanges: {
        startUtc: string;
        endUtc: string;
        timeZone: string;
        label?: string;
      }[];
    };
    record: {
      startUtc: string;
      endUtc: string;
      timeZone?: string;
      response?: "yes" | "reluctant" | "no";
      note?: string;
    };
  },
) {
  assertAvailabilityCellAlignment(
    args.record.startUtc,
    args.record.endUtc,
    args.meeting.granularityMinutes,
    args.meeting.canonicalTimeZone,
  );
  assertAvailabilityCellDuration(
    args.record.startUtc,
    args.record.endUtc,
    args.meeting.granularityMinutes,
  );
  if (
    !isSlotInsideAllowedRanges(
      { startUtc: args.record.startUtc, endUtc: args.record.endUtc },
      args.meeting.allowedTimeRanges,
    )
  ) {
    throw new Error("Availability cell must be inside an allowed time range");
  }

  const now = Date.now();
  const cellKey = makeAvailabilityCellKey(args.record.startUtc, args.record.endUtc);
  const [normalizedStartUtc, normalizedEndUtc] = cellKey.split("_") as [string, string];
  const existingRecord = await ctx.db
    .query("availabilityRecords")
    .withIndex("by_membership_cell", (q) =>
      q.eq("membershipId", args.membershipId).eq("cellKey", cellKey),
    )
    .unique();

  if (!args.record.response) {
    if (existingRecord) {
      await ctx.db.delete(existingRecord._id);
    }
    return { kind: "cleared" as const, cellKey };
  }

  const recordFields = {
    meetingId: args.meeting._id,
    membershipId: args.membershipId,
    startUtc: normalizedStartUtc,
    endUtc: normalizedEndUtc,
    timeZone: args.meeting.canonicalTimeZone,
    cellKey,
    response: args.record.response,
    note: normalizeAvailabilityNote(args.record.note),
    updatedAt: now,
  };

  if (existingRecord) {
    await ctx.db.patch(existingRecord._id, recordFields);
    return { kind: "saved" as const, availabilityRecordId: existingRecord._id };
  }

  const availabilityRecordId = await ctx.db.insert("availabilityRecords", {
    ...recordFields,
    createdAt: now,
  });
  return { kind: "saved" as const, availabilityRecordId };
}

function dedupeAvailabilityRecordBatch<
  T extends {
    startUtc: string;
    endUtc: string;
  },
>(records: T[]) {
  const seenCellKeys = new Set<string>();
  for (const record of records) {
    const cellKey = makeAvailabilityCellKey(record.startUtc, record.endUtc);
    if (seenCellKeys.has(cellKey)) {
      throw new Error("Availability batch contains duplicate cells");
    }
    seenCellKeys.add(cellKey);
  }
  return records;
}

function redactPublicMeeting(meeting: {
  _id: Id<"meetings">;
  title: string;
  slug: string;
  description?: string;
  lifecycleState: "open" | "finalized";
  lifecycleRevision: number;
  adminMode: "roleBased" | "everyoneAdmin";
  canonicalTimeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  allowedTimeRanges: {
    startUtc: string;
    endUtc: string;
    timeZone: string;
    label?: string;
  }[];
  finalizedAt?: number;
  finalizedSlot?: {
    startUtc: string;
    endUtc: string;
    timeZone?: string;
  };
  createdAt: number;
  updatedAt: number;
}) {
  return {
    _id: meeting._id,
    title: meeting.title,
    slug: meeting.slug,
    description: meeting.description,
    lifecycleState: meeting.lifecycleState,
    lifecycleRevision: meeting.lifecycleRevision,
    adminMode: meeting.adminMode,
    canonicalTimeZone: meeting.canonicalTimeZone,
    granularityMinutes: meeting.granularityMinutes,
    durationMinutes: meeting.durationMinutes,
    allowedTimeRanges: meeting.allowedTimeRanges,
    finalizedAt: meeting.finalizedAt,
    finalizedSlot: meeting.finalizedSlot,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
  };
}

function redactParticipantMembership(membership: {
  emailIdentityId?: Id<"emailIdentities">;
  displayName?: string;
  role: MembershipRole;
}) {
  return {
    hasEmailIdentity: Boolean(membership.emailIdentityId),
    displayName: membership.displayName,
    role: membership.role,
  };
}

function assertMembershipHasDisplayName(membership: { displayName?: string }) {
  normalizeParticipantDisplayName(membership.displayName ?? "");
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
