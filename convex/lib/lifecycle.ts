import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { buildLifecycleNotificationPlaceholders } from "../domain/finalization";

export async function insertAuditEvent(
  ctx: MutationCtx,
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

export async function insertNotificationPlaceholdersForMeeting(
  ctx: MutationCtx,
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
