export const DEFAULT_MAGIC_LINK_TTL_MS = 30 * 60 * 1000;

export type MagicLinkState = {
  consumedAt?: number;
  expiresAt: number;
};

export type VerifiedEmailIdentity = {
  verifiedAt?: number;
};

export type EmailAttachMembership = {
  emailIdentityId?: string;
};

export type IdentityDashboardMembership = {
  _id: string;
  meetingId: string;
  role: "admin" | "member";
  displayName?: string;
  revokedAt?: number;
  updatedAt: number;
  hasAvailability: boolean;
};

export type RecoverableMembershipInput = {
  role: "admin" | "member";
  revokedAt?: number;
  hasAvailability: boolean;
};

export function normalizeMagicLinkExpiry({
  now,
  requestedExpiresAt,
  maxTtlMs = DEFAULT_MAGIC_LINK_TTL_MS,
}: {
  now: number;
  requestedExpiresAt?: number;
  maxTtlMs?: number;
}): number {
  const expiresAt = requestedExpiresAt ?? now + maxTtlMs;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("Magic link expiry must be in the future");
  }
  if (expiresAt - now > maxTtlMs) {
    throw new Error("Magic link expiry exceeds the maximum lifetime");
  }
  return expiresAt;
}

export function assertMagicLinkCanBeConsumed<T extends MagicLinkState>(
  magicLink: T | null | undefined,
  now: number,
): asserts magicLink is T {
  if (!magicLink || magicLink.consumedAt || magicLink.expiresAt <= now) {
    throw new Error("Magic link is invalid or expired");
  }
}

export function assertVerifiedEmailIdentity<T extends VerifiedEmailIdentity>(
  identity: T | null | undefined,
): asserts identity is T & { verifiedAt: number } {
  if (!identity?.verifiedAt) {
    throw new Error("Email identity must be verified");
  }
}

export function assertCanAttachEmailIdentityToMembership({
  membership,
  emailIdentityId,
}: {
  membership: EmailAttachMembership;
  emailIdentityId: string;
}): void {
  if (membership.emailIdentityId && membership.emailIdentityId !== emailIdentityId) {
    throw new Error("Membership is already attached to another email identity");
  }
}

export function filterRecoverableDashboardMemberships(
  memberships: IdentityDashboardMembership[],
): IdentityDashboardMembership[] {
  return memberships
    .filter((membership) => membership.revokedAt === undefined)
    .filter(isMembershipRecoverable)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function isMembershipRecoverable(membership: RecoverableMembershipInput): boolean {
  return (
    membership.revokedAt === undefined &&
    (membership.role === "admin" || membership.hasAvailability)
  );
}
