import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertAvailabilityCellAlignment,
  assertAvailabilityCellDuration,
  getMembershipCapabilities,
  isSlotInsideAllowedRanges,
  makeAvailabilityCellKey,
  normalizeFinalizedSlot,
  normalizeMeetingSettings,
  normalizeMeetingTitle,
  normalizeParticipantDisplayName,
  slugifyMeetingTitle,
  transitionMeetingLifecycle,
} from "./domain/model";
import { assertVerifiedEmailIdentity } from "./domain/identity";
import {
  buildFinalizeMeetingPatch,
  buildLifecycleNotificationPlaceholders,
  buildReopenMeetingPatch,
} from "./domain/finalization";
import { createSecretToken } from "./domain/tokens";
import {
  buildMeetingResults,
  canViewerReadDetailedResults,
  type ResultParticipant,
} from "./domain/results";
import {
  apiTokenScopeValidator,
  availabilityResponseValidator,
  finalizedSlotValidator,
  privacyModeValidator,
} from "./domain/validators";
import {
  assertApiCanEditMembershipAvailability,
  assertApiTokenHasScopes,
  normalizeApiTokenScopes,
  selectApiMembershipForMeeting,
  type ApiTokenScope,
} from "./domain/agent-api";

const INTERNAL_IDENTITY_SECRET_ENV = "MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET";
const DEV_INTERNAL_IDENTITY_SECRET =
  "dev-only-meeting-scheduler-identity-internal-secret";

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

type ApiCredential = {
  token: Doc<"apiTokens">;
  identity: Doc<"emailIdentities">;
};

export const createApiToken = mutation({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
    label: v.optional(v.string()),
    scopes: v.array(apiTokenScopeValidator),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);
    const scopes = normalizeApiTokenScopes(args.scopes);
    const now = Date.now();
    const apiToken = await createSecretToken("api");
    await ctx.db.insert("apiTokens", {
      emailIdentityId: args.emailIdentityId,
      label: normalizeTokenLabel(args.label),
      scopes,
      tokenHash: apiToken.tokenHash,
      tokenFingerprint: apiToken.tokenFingerprint,
      tokenVersion: 1,
      tokenCreatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      apiToken: apiToken.rawToken,
      tokenFingerprint: apiToken.tokenFingerprint,
      scopes,
      createdAt: now,
    };
  },
});

export const revokeApiToken = mutation({
  args: {
    internalSecret: v.string(),
    emailIdentityId: v.id("emailIdentities"),
    tokenFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertInternalIdentitySecret(args.internalSecret);
    const identity = await ctx.db.get(args.emailIdentityId);
    assertVerifiedEmailIdentity(identity);
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_token_fingerprint", (q) =>
        q.eq("tokenFingerprint", args.tokenFingerprint),
      )
      .unique();
    if (!token || token.emailIdentityId !== args.emailIdentityId) {
      throw new Error("API token not found");
    }
    if (token.revokedAt !== undefined) {
      return {
        tokenFingerprint: token.tokenFingerprint,
        revokedAt: token.revokedAt,
      };
    }
    const now = Date.now();
    await ctx.db.patch(token._id, {
      revokedAt: now,
      updatedAt: now,
    });
    return {
      tokenFingerprint: token.tokenFingerprint,
      revokedAt: now,
    };
  },
});

export const createMeeting = mutation({
  args: {
    tokenHash: v.string(),
    title: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    creatorName: v.optional(v.string()),
    creatorPrivacyMode: v.optional(privacyModeValidator),
    settings: v.object(meetingSettingsArgs),
  },
  handler: async (ctx, args) => {
    const credential = await requireApiCredential(ctx, args.tokenHash, [
      "meetings:create",
    ]);
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

    const meetingId = await ctx.db.insert("meetings", {
      title,
      slug,
      description: args.description?.trim(),
      lifecycleState: "open",
      lifecycleRevision: 1,
      adminMode: "roleBased",
      canonicalTimeZone: settings.canonicalTimeZone,
      granularityMinutes: settings.granularityMinutes,
      durationMinutes: settings.durationMinutes,
      allowedTimeRanges: settings.allowedTimeRanges,
      createdAt: now,
      updatedAt: now,
    });
    const adminMembershipId = await ctx.db.insert("memberships", {
      meetingId,
      emailIdentityId: credential.identity._id,
      displayName: args.creatorName?.trim() ?? credential.identity.displayName,
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
      metadata: { slug, apiTokenFingerprint: credential.token.tokenFingerprint },
      now,
    });
    await touchApiToken(ctx, credential.token._id, now);

    return {
      meetingId,
      slug,
      adminMembershipId,
      tokenFingerprint: credential.token.tokenFingerprint,
    };
  },
});

export const readMeeting = query({
  args: {
    tokenHash: v.optional(v.string()),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await readMeetingBySlug(ctx, args.slug);
    if (!meeting) {
      return null;
    }
    const credential = args.tokenHash
      ? await requireApiCredential(ctx, args.tokenHash, ["meetings:read"])
      : null;
    const viewer = credential
      ? await findCredentialMembershipForMeeting(ctx, credential, meeting)
      : null;
    const results = await buildResultsForMeeting(ctx, meeting, viewer);

    return {
      meeting: redactPublicMeeting(meeting),
      viewer: viewer ? redactApiMembership(viewer) : null,
      capabilities: getMembershipCapabilities(meeting, viewer),
      results,
    };
  },
});

export const readRecommendations = query({
  args: {
    tokenHash: v.optional(v.string()),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const meeting = await readMeetingBySlug(ctx, args.slug);
    if (!meeting) {
      return null;
    }
    const credential = args.tokenHash
      ? await requireApiCredential(ctx, args.tokenHash, ["recommendations:read"])
      : null;
    const viewer = credential
      ? await findCredentialMembershipForMeeting(ctx, credential, meeting)
      : null;
    return await buildResultsForMeeting(ctx, meeting, viewer);
  },
});

export const createParticipant = mutation({
  args: {
    tokenHash: v.string(),
    meetingSlug: v.string(),
    displayName: v.string(),
    privacyMode: v.optional(privacyModeValidator),
  },
  handler: async (ctx, args) => {
    const credential = await requireApiCredential(ctx, args.tokenHash, [
      "availability:write",
    ]);
    const meeting = await requireMeetingBySlug(ctx, args.meetingSlug);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    const now = Date.now();
    const displayName = normalizeParticipantDisplayName(args.displayName);
    const membershipToken = await createSecretToken("membership");
    const membershipId = await ctx.db.insert("memberships", {
      meetingId: meeting._id,
      emailIdentityId: credential.identity._id,
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
      actorMembershipId: membershipId,
      targetMembershipId: membershipId,
      kind: "membership.created_by_api",
      metadata: { apiTokenFingerprint: credential.token.tokenFingerprint },
      now,
    });
    await touchApiToken(ctx, credential.token._id, now);
    return {
      meetingId: meeting._id,
      membershipId,
      displayName,
      role: "member" as const,
    };
  },
});

export const saveAvailability = mutation({
  args: {
    tokenHash: v.string(),
    meetingSlug: v.string(),
    membershipId: v.id("memberships"),
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
    const credential = await requireApiCredential(ctx, args.tokenHash, [
      "availability:write",
    ]);
    const meeting = await requireMeetingBySlug(ctx, args.meetingSlug);
    if (meeting.lifecycleState !== "open") {
      throw new Error("Finalized meetings are read-only until reopened");
    }
    const membership = await ctx.db.get(args.membershipId);
    assertApiCanEditMembershipAvailability(membership, {
      emailIdentityId: credential.identity._id,
      meetingId: meeting._id,
    });
    dedupeAvailabilityRecordBatch(args.records);
    const savedRecordIds: Id<"availabilityRecords">[] = [];
    const clearedCellKeys: string[] = [];
    for (const record of args.records) {
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
    const now = Date.now();
    await insertAuditEvent(ctx, {
      meetingId: meeting._id,
      actorMembershipId: membership._id,
      targetMembershipId: membership._id,
      kind: "availability.updated_by_api",
      metadata: {
        savedCount: savedRecordIds.length,
        clearedCount: clearedCellKeys.length,
        apiTokenFingerprint: credential.token.tokenFingerprint,
      },
      now,
    });
    await touchApiToken(ctx, credential.token._id, now);
    return { membershipId: membership._id, savedRecordIds, clearedCellKeys };
  },
});

export const finalizeMeeting = mutation({
  args: {
    tokenHash: v.string(),
    meetingSlug: v.string(),
    finalizedSlot: finalizedSlotValidator,
  },
  handler: async (ctx, args) => {
    const credential = await requireApiCredential(ctx, args.tokenHash, [
      "meetings:finalize",
    ]);
    const meeting = await requireMeetingBySlug(ctx, args.meetingSlug);
    const membership = await requireAdminMembershipForCredential(
      ctx,
      credential,
      meeting,
    );
    const nextLifecycleState = transitionMeetingLifecycle(
      meeting,
      membership,
      "finalize",
    );
    const finalizedSlot = normalizeFinalizedSlot(args.finalizedSlot, meeting);
    const now = Date.now();
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
      kind: "meeting.finalized_by_api",
      metadata: {
        startUtc: finalizedSlot.startUtc,
        endUtc: finalizedSlot.endUtc,
        timeZone: finalizedSlot.timeZone,
        apiTokenFingerprint: credential.token.tokenFingerprint,
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
    await touchApiToken(ctx, credential.token._id, now);
    return { meetingId: meeting._id, lifecycleState: nextLifecycleState };
  },
});

export const reopenMeeting = mutation({
  args: {
    tokenHash: v.string(),
    meetingSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const credential = await requireApiCredential(ctx, args.tokenHash, [
      "meetings:finalize",
    ]);
    const meeting = await requireMeetingBySlug(ctx, args.meetingSlug);
    const membership = await requireAdminMembershipForCredential(
      ctx,
      credential,
      meeting,
    );
    const nextLifecycleState = transitionMeetingLifecycle(meeting, membership, "reopen");
    const now = Date.now();
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
      kind: "meeting.reopened_by_api",
      metadata: { apiTokenFingerprint: credential.token.tokenFingerprint },
      now,
    });
    await insertNotificationPlaceholdersForMeeting(ctx, {
      meetingId: meeting._id,
      kind: "meeting.reopened",
      lifecycleRevision: meetingPatch.lifecycleRevision,
      payload: {},
      now,
    });
    await touchApiToken(ctx, credential.token._id, now);
    return { meetingId: meeting._id, lifecycleState: nextLifecycleState };
  },
});

async function requireApiCredential(
  ctx: QueryLikeCtx,
  tokenHash: string,
  requiredScopes: ApiTokenScope[],
): Promise<ApiCredential> {
  const token = await ctx.db
    .query("apiTokens")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  assertApiTokenHasScopes(token, requiredScopes);
  const identity = await ctx.db.get(token.emailIdentityId);
  assertVerifiedEmailIdentity(identity);
  return { token, identity };
}

async function findCredentialMembershipForMeeting(
  ctx: QueryLikeCtx,
  credential: ApiCredential,
  meeting: Pick<Doc<"meetings">, "_id" | "adminMode" | "lifecycleState">,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_email_identity", (q) =>
      q.eq("emailIdentityId", credential.identity._id),
    )
    .collect();
  return selectApiMembershipForMeeting(memberships, meeting);
}

async function requireAdminMembershipForCredential(
  ctx: QueryLikeCtx,
  credential: ApiCredential,
  meeting: Doc<"meetings">,
) {
  const membership = await findCredentialMembershipForMeeting(ctx, credential, meeting);
  const capabilities = getMembershipCapabilities(meeting, membership);
  if (!membership || !capabilities.canAdminister) {
    throw new Error("API token owner cannot administer this meeting");
  }
  return membership;
}

async function readMeetingBySlug(ctx: QueryLikeCtx, slug: string) {
  return await ctx.db
    .query("meetings")
    .withIndex("by_slug", (q) => q.eq("slug", slugifyMeetingTitle(slug)))
    .unique();
}

async function requireMeetingBySlug(ctx: QueryLikeCtx, slug: string) {
  const meeting = await readMeetingBySlug(ctx, slug);
  if (!meeting) {
    throw new Error("Meeting not found");
  }
  return meeting;
}

function normalizeTokenLabel(label: string | undefined) {
  const normalized = label?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > 80) {
    throw new Error("API token label must be 80 characters or fewer");
  }
  return normalized;
}

async function touchApiToken(
  ctx: MutationLikeCtx,
  tokenId: Id<"apiTokens">,
  now = Date.now(),
) {
  await ctx.db.patch(tokenId, {
    tokenLastUsedAt: now,
    updatedAt: now,
  });
}

async function buildResultsForMeeting(
  ctx: QueryLikeCtx,
  meeting: Doc<"meetings">,
  viewer: Doc<"memberships"> | null,
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

function redactPublicMeeting(meeting: Doc<"meetings">) {
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

function redactApiMembership(membership: Doc<"memberships">) {
  return {
    _id: membership._id,
    displayName: membership.displayName,
    role: membership.role,
    privacyMode: membership.privacyMode,
  };
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
    meeting: Doc<"meetings">;
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

function dedupeAvailabilityRecordBatch<T extends { startUtc: string; endUtc: string }>(
  records: T[],
) {
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

function isExplicitLocalDevelopmentRuntime(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") === true
  );
}

type QueryLikeCtx = QueryCtx;
type MutationLikeCtx = MutationCtx;
