import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAvailabilityCellAlignment,
  assertAvailabilityCellDuration,
  assertCanAdminister,
  assertCanEditOpenMeeting,
  getMembershipCapabilities,
  isSlotInsideAllowedRanges,
  makeAvailabilityCellKey,
  normalizeEmailAddress,
  normalizeFinalizedSlot,
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
  filterRecoverableDashboardMemberships,
  isMembershipRecoverable,
  normalizeMagicLinkExpiry,
} from "./domain/identity";
import {
  buildFinalizeMeetingPatch,
  buildLifecycleNotificationPlaceholders,
  buildReopenMeetingPatch,
  shouldAttemptNotificationDelivery,
} from "./domain/finalization";
import { createSecretToken, hashSecretToken } from "./domain/tokens";
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

const INTERNAL_IDENTITY_SECRET_ENV = "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET";
const DEV_INTERNAL_IDENTITY_SECRET =
  "dev-only-meeting-scheduler-identity-internal-secret";
const EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const NOTIFICATION_DELIVERY_LEASE_MS = 15 * 60 * 1000;
const MAX_NOTIFICATION_ATTEMPTS = 5;

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

export const readPublicMeetingBySlug = query({
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

export const createParticipantMembership = mutation({
  args: {
    meetingSlug: v.string(),
    displayName: v.string(),
    privacyMode: v.optional(privacyModeValidator),
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

    const displayName = normalizeParticipantDisplayName(args.displayName);
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

export const updateMembershipDisplayName = mutation({
  args: {
    membershipToken: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
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
    finalizedSlot: finalizedSlotValidator,
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

export const createMagicLink = mutation({
  args: {
    email: v.string(),
    displayName: v.optional(v.string()),
    purpose: v.union(v.literal("emailVerification"), v.literal("membershipRecovery")),
    membershipId: v.optional(v.id("memberships")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = normalizeMagicLinkExpiry({
      now,
      requestedExpiresAt: args.expiresAt,
    });

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
    if (args.purpose === "emailVerification") {
      await assertEmailVerificationRequestAllowed(ctx, emailIdentityId, now);
    }
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
      expiresAt,
      createdAt: now,
    });

    await ctx.db.insert("notificationOutbox", {
      meetingId: recoveryTarget.meetingId,
      membershipId: recoveryTarget.membershipId,
      emailIdentityId,
      kind: `magicLink.${args.purpose}`,
      status: "cancelled",
      dedupeKey: `magicLink:${magicLinkToken.tokenFingerprint}`,
      payload: {
        magicLinkId,
        tokenFingerprint: magicLinkToken.tokenFingerprint,
      },
      attempts: 0,
      lastError: "Magic link delivery requires the server email adapter route",
      createdAt: now,
      updatedAt: now,
    });

    return {
      magicLinkId,
      tokenFingerprint: magicLinkToken.tokenFingerprint,
      devMagicLinkToken: shouldExposeDevMagicLinkToken()
        ? magicLinkToken.rawToken
        : undefined,
      deliveryQueued: false,
    };
  },
});

export const requestEmailVerification = mutation({
  args: {
    email: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await createEmailVerificationMagicLink(ctx, {
      email: args.email,
      displayName: args.displayName,
    });
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
      const remaining = limit - notificationIds.length;
      const notifications = await ctx.db
        .query("notificationOutbox")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(remaining);
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
    const membership = await requireMembershipByToken(ctx, args.membershipToken);
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
      .collect();
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
      .collect();

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

    assertMagicLinkCanBeConsumed(magicLink, now);
    if (magicLink.purpose === "emailVerification") {
      throw new Error("Use the email verification flow for this magic link");
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

export const completeEmailVerification = mutation({
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

    assertMagicLinkCanBeConsumed(magicLink, now);
    if (magicLink.purpose !== "emailVerification" || !magicLink.emailIdentityId) {
      throw new Error("Magic link cannot verify an email identity");
    }

    const identity = await ctx.db.get(magicLink.emailIdentityId);
    if (!identity) {
      throw new Error("Email identity not found");
    }

    await ctx.db.patch(magicLink._id, { consumedAt: now });
    await ctx.db.patch(identity._id, {
      verifiedAt: identity.verifiedAt ?? now,
      updatedAt: now,
    });

    return {
      emailIdentityId: identity._id,
      normalizedEmail: identity.normalizedEmail,
      verifiedAt: identity.verifiedAt ?? now,
    };
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

    const membership = await requireMembershipByToken(ctx, args.membershipToken);
    assertCanAttachEmailIdentityToMembership({
      membership: {
        emailIdentityId: membership.emailIdentityId,
      },
      emailIdentityId: args.emailIdentityId,
    });

    await ctx.db.patch(membership._id, {
      emailIdentityId: args.emailIdentityId,
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

export const listIdentityDashboard = query({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_email_identity", (q) => q.eq("emailIdentityId", identity._id))
      .collect();
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

    const recoverableMembershipIds = new Set(
      filterRecoverableDashboardMemberships(
        rows.map((row) => ({
          _id: row._id,
          meetingId: row.meetingId,
          role: row.role,
          displayName: row.displayName,
          revokedAt: row.revokedAt,
          updatedAt: row.updatedAt,
          hasAvailability: row.hasAvailability,
        })),
      ).map((membership) => membership._id),
    );

    return {
      identity: {
        emailIdentityId: identity._id,
        normalizedEmail: identity.normalizedEmail,
        verifiedAt: identity.verifiedAt,
      },
      memberships: rows
        .filter((row) => recoverableMembershipIds.has(row._id))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((row) => ({
          membershipId: row._id,
          role: row.role,
          displayName: row.displayName,
          hasAvailability: row.hasAvailability,
          meeting: row.meeting,
        })),
    };
  },
});

export const readVerifiedEmailIdentity = query({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);

    return {
      emailIdentityId: identity._id,
      normalizedEmail: identity.normalizedEmail,
      verifiedAt: identity.verifiedAt,
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

export const createRecoveredMembershipLink = mutation({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const now = Date.now();
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);
    const membership = await ctx.db.get(args.membershipId);
    if (
      !membership ||
      membership.revokedAt !== undefined ||
      membership.emailIdentityId !== args.emailIdentityId
    ) {
      throw new Error("Membership is not recoverable for this email identity");
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
      throw new Error("Membership is not recoverable for this email identity");
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
      kind: "membership.recovery_link_created",
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
    .collect();
  const availabilityRecords = await ctx.db
    .query("availabilityRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
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

async function findMembershipByToken(ctx: QueryLikeCtx, membershipToken: string) {
  const resolved = await resolveMembershipByToken(ctx, membershipToken);
  return resolved?.membership ?? null;
}

async function resolveMembershipByToken(ctx: QueryLikeCtx, membershipToken: string) {
  const tokenHash = await hashSecretToken(membershipToken);
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
      providedSecret === DEV_INTERNAL_IDENTITY_SECRET
    ) {
      return;
    }
    throw new Error(`${INTERNAL_IDENTITY_SECRET_ENV} is required`);
  }
  if (providedSecret !== expectedSecret) {
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
    note: args.record.note?.trim(),
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
