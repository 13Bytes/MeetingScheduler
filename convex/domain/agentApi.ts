import { getMembershipCapabilities } from "./model";
import type { PermissionMeeting, PermissionMembership } from "./model";

export const apiTokenScopes = [
  "meetings:create",
  "meetings:read",
  "availability:write",
  "recommendations:read",
  "meetings:finalize",
] as const;

export type ApiTokenScope = (typeof apiTokenScopes)[number];

export type ApiScopedToken = {
  scopes: ApiTokenScope[];
  revokedAt?: number;
};

export type ApiOwnedMembership = PermissionMembership & {
  _id: string;
  meetingId: string;
  emailIdentityId?: string;
};

type ApiEditableMembership = NonNullable<PermissionMembership> & {
  meetingId: string;
  emailIdentityId?: string;
};

export function normalizeApiTokenScopes(scopes: ApiTokenScope[]) {
  const uniqueScopes = Array.from(new Set(scopes));
  if (uniqueScopes.length === 0) {
    throw new Error("At least one API token scope is required");
  }
  return uniqueScopes;
}

export function assertApiTokenHasScopes<T extends ApiScopedToken>(
  token: T | null | undefined,
  requiredScopes: ApiTokenScope[],
): asserts token is T {
  if (!token || token.revokedAt !== undefined) {
    throw new Error("API token is invalid or revoked");
  }
  for (const scope of requiredScopes) {
    if (!token.scopes.includes(scope)) {
      throw new Error(`API token is missing required scope: ${scope}`);
    }
  }
}

export function selectApiMembershipForMeeting<
  Membership extends ApiOwnedMembership,
  Meeting extends PermissionMeeting & { _id: string },
>(memberships: Membership[], meeting: Meeting): Membership | null {
  const activeMeetingMemberships = memberships.filter(
    (membership) =>
      membership.meetingId === meeting._id && membership.revokedAt === undefined,
  );
  return (
    activeMeetingMemberships.find(
      (membership) => getMembershipCapabilities(meeting, membership).canAdminister,
    ) ??
    activeMeetingMemberships[0] ??
    null
  );
}

export function assertApiCanEditMembershipAvailability<
  Membership extends ApiEditableMembership,
>(
  membership: Membership | null | undefined,
  args: {
    emailIdentityId: string;
    meetingId: string;
  },
): asserts membership is Membership {
  if (
    !membership ||
    membership.meetingId !== args.meetingId ||
    membership.revokedAt !== undefined
  ) {
    throw new Error("Membership not found");
  }
  if (membership.emailIdentityId !== args.emailIdentityId) {
    throw new Error("API token cannot edit availability for this membership");
  }
}
