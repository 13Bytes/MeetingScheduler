import type { Slot } from "./model";

export function buildFinalizeMeetingPatch<MembershipId extends string>(args: {
  lifecycleRevision: number;
  finalizedAt: number;
  finalizedByMembershipId: MembershipId;
  finalizedSlot: Slot;
}) {
  return {
    lifecycleState: "finalized" as const,
    lifecycleRevision: args.lifecycleRevision + 1,
    finalizedAt: args.finalizedAt,
    finalizedByMembershipId: args.finalizedByMembershipId,
    finalizedSlot: args.finalizedSlot,
    updatedAt: args.finalizedAt,
  };
}

export function buildReopenMeetingPatch<MembershipId extends string>(args: {
  lifecycleRevision: number;
  reopenedAt: number;
  reopenedByMembershipId: MembershipId;
}) {
  return {
    lifecycleState: "open" as const,
    lifecycleRevision: args.lifecycleRevision + 1,
    finalizedAt: undefined,
    finalizedByMembershipId: undefined,
    finalizedSlot: undefined,
    reopenedAt: args.reopenedAt,
    reopenedByMembershipId: args.reopenedByMembershipId,
    updatedAt: args.reopenedAt,
  };
}

export function buildLifecycleNotificationPlaceholders<
  MeetingId extends string,
  MembershipId extends string,
  EmailIdentityId extends string,
>(args: {
  meetingId: MeetingId;
  memberships: {
    _id: MembershipId;
    emailIdentityId?: EmailIdentityId;
    revokedAt?: number;
  }[];
  kind: "meeting.finalized" | "meeting.reopened";
  lifecycleRevision: number;
  payload: Record<string, string | number | boolean | null>;
  now: number;
}) {
  return args.memberships
    .filter((membership) => membership.revokedAt === undefined)
    .filter(
      (
        membership,
      ): membership is {
        _id: MembershipId;
        emailIdentityId: EmailIdentityId;
      } => membership.emailIdentityId !== undefined,
    )
    .map((membership) => ({
      meetingId: args.meetingId,
      membershipId: membership._id,
      emailIdentityId: membership.emailIdentityId,
      kind: args.kind,
      status: "pending" as const,
      dedupeKey: `${args.kind}:${args.meetingId}:${args.lifecycleRevision}:${membership._id}`,
      payload: {
        lifecycleRevision: args.lifecycleRevision,
        ...args.payload,
      },
      attempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    }));
}
