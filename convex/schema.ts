import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  adminModeValidator,
  allowedTimeRangeValidator,
  availabilityResponseValidator,
  finalizedSlotValidator,
  lifecycleStateValidator,
  magicLinkPurposeValidator,
  membershipRoleValidator,
  metadataValidator,
  notificationStatusValidator,
  privacyModeValidator,
  tokenFieldsValidator,
} from "./domain/validators";

export default defineSchema({
  meetings: defineTable({
    title: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    lifecycleState: lifecycleStateValidator,
    lifecycleRevision: v.number(),
    adminMode: adminModeValidator,
    canonicalTimeZone: v.string(),
    granularityMinutes: v.number(),
    durationMinutes: v.number(),
    allowedTimeRanges: v.array(allowedTimeRangeValidator),
    createdByMembershipId: v.optional(v.id("memberships")),
    finalizedAt: v.optional(v.number()),
    finalizedByMembershipId: v.optional(v.id("memberships")),
    finalizedSlot: v.optional(finalizedSlotValidator),
    reopenedAt: v.optional(v.number()),
    reopenedByMembershipId: v.optional(v.id("memberships")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_lifecycle_state", ["lifecycleState"]),

  memberships: defineTable({
    meetingId: v.id("meetings"),
    emailIdentityId: v.optional(v.id("emailIdentities")),
    displayName: v.optional(v.string()),
    role: membershipRoleValidator,
    privacyMode: privacyModeValidator,
    ...tokenFieldsValidator,
    tokenLastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_role", ["meetingId", "role"])
    .index("by_email_identity", ["emailIdentityId"])
    .index("by_token_hash", ["tokenHash"]),

  allowedTimeRanges: defineTable({
    meetingId: v.id("meetings"),
    startUtc: v.string(),
    endUtc: v.string(),
    timeZone: v.string(),
    label: v.optional(v.string()),
    createdByMembershipId: v.optional(v.id("memberships")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_start", ["meetingId", "startUtc"]),

  availabilityRecords: defineTable({
    meetingId: v.id("meetings"),
    membershipId: v.id("memberships"),
    startUtc: v.string(),
    endUtc: v.string(),
    timeZone: v.string(),
    cellKey: v.string(),
    response: availabilityResponseValidator,
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_meeting_cell", ["meetingId", "cellKey"])
    .index("by_membership", ["membershipId"])
    .index("by_membership_cell", ["membershipId", "cellKey"]),

  emailIdentities: defineTable({
    normalizedEmail: v.string(),
    displayName: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_normalized_email", ["normalizedEmail"]),

  magicLinks: defineTable({
    purpose: magicLinkPurposeValidator,
    emailIdentityId: v.optional(v.id("emailIdentities")),
    membershipId: v.optional(v.id("memberships")),
    meetingId: v.optional(v.id("meetings")),
    ...tokenFieldsValidator,
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email_identity", ["emailIdentityId"])
    .index("by_membership", ["membershipId"])
    .index("by_expiration", ["expiresAt"]),

  notificationOutbox: defineTable({
    meetingId: v.optional(v.id("meetings")),
    membershipId: v.optional(v.id("memberships")),
    emailIdentityId: v.optional(v.id("emailIdentities")),
    kind: v.string(),
    status: notificationStatusValidator,
    dedupeKey: v.optional(v.string()),
    payload: metadataValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_meeting", ["meetingId"])
    .index("by_dedupe_key", ["dedupeKey"]),

  auditEvents: defineTable({
    meetingId: v.id("meetings"),
    actorMembershipId: v.optional(v.id("memberships")),
    targetMembershipId: v.optional(v.id("memberships")),
    kind: v.string(),
    metadata: metadataValidator,
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_actor_membership", ["actorMembershipId"]),
});
