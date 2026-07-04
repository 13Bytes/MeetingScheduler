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
  emailIdentities: {
    _id: EmailIdentityId;
    normalizedEmail: string;
    verifiedAt?: number;
  }[];
  kind: "meeting.finalized" | "meeting.reopened";
  lifecycleRevision: number;
  payload: Record<string, string | number | boolean | null>;
  now: number;
}) {
  const verifiedIdentityIds = new Set(
    args.emailIdentities
      .filter((identity) => identity.verifiedAt !== undefined)
      .map((identity) => identity._id),
  );
  const seenIdentityIds = new Set<EmailIdentityId>();

  return args.memberships
    .filter((membership) => membership.revokedAt === undefined)
    .filter(
      (
        membership,
      ): membership is {
        _id: MembershipId;
        emailIdentityId: EmailIdentityId;
      } =>
        membership.emailIdentityId !== undefined &&
        verifiedIdentityIds.has(membership.emailIdentityId),
    )
    .filter((membership) => {
      if (seenIdentityIds.has(membership.emailIdentityId)) {
        return false;
      }
      seenIdentityIds.add(membership.emailIdentityId);
      return true;
    })
    .map((membership) => ({
      meetingId: args.meetingId,
      membershipId: membership._id,
      emailIdentityId: membership.emailIdentityId,
      kind: args.kind,
      status: "queued" as const,
      dedupeKey: `${args.kind}:${args.meetingId}:${args.lifecycleRevision}:${membership.emailIdentityId}`,
      payload: {
        ...args.payload,
        lifecycleRevision: args.lifecycleRevision,
      },
      attempts: 0,
      createdAt: args.now,
      updatedAt: args.now,
    }));
}

export function shouldAttemptNotificationDelivery(args: {
  status: "queued" | "sending" | "pending" | "sent" | "failed" | "cancelled";
  scheduledFor?: number;
  attempts: number;
  now: number;
  maxAttempts: number;
}) {
  if (args.status === "sent" || args.status === "cancelled") {
    return false;
  }
  if (args.attempts >= args.maxAttempts) {
    return false;
  }
  if (args.scheduledFor !== undefined && args.scheduledFor > args.now) {
    return false;
  }
  return (
    args.status === "queued" ||
    args.status === "pending" ||
    args.status === "failed" ||
    args.status === "sending"
  );
}
