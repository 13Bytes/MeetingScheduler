const dayMs = 24 * 60 * 60 * 1000;

export type RetentionWindowsMs = {
  anonymousMeetingMs: number;
  inactiveMembershipMs: number;
  expiredMagicLinkMs: number;
  revokedCredentialMs: number;
  staleNotificationMs: number;
  staleRateLimitMs: number;
};

export const defaultRetentionWindowsMs: RetentionWindowsMs = {
  anonymousMeetingMs: 180 * dayMs,
  inactiveMembershipMs: 180 * dayMs,
  expiredMagicLinkMs: 7 * dayMs,
  revokedCredentialMs: 90 * dayMs,
  staleNotificationMs: 30 * dayMs,
  staleRateLimitMs: 2 * dayMs,
};

export type RetentionCutoffs = {
  anonymousMeetingBefore: number;
  inactiveMembershipBefore: number;
  expiredMagicLinkBefore: number;
  revokedCredentialBefore: number;
  staleNotificationBefore: number;
  staleRateLimitBefore: number;
};

export function buildRetentionCutoffs(
  now: number,
  windows: Partial<RetentionWindowsMs> = {},
): RetentionCutoffs {
  const resolved = normalizeRetentionWindows(windows);
  return {
    anonymousMeetingBefore: now - resolved.anonymousMeetingMs,
    inactiveMembershipBefore: now - resolved.inactiveMembershipMs,
    expiredMagicLinkBefore: now - resolved.expiredMagicLinkMs,
    revokedCredentialBefore: now - resolved.revokedCredentialMs,
    staleNotificationBefore: now - resolved.staleNotificationMs,
    staleRateLimitBefore: now - resolved.staleRateLimitMs,
  };
}

export function normalizeRetentionWindows(
  windows: Partial<RetentionWindowsMs>,
): RetentionWindowsMs {
  return {
    anonymousMeetingMs: positiveOrDefault(
      windows.anonymousMeetingMs,
      defaultRetentionWindowsMs.anonymousMeetingMs,
    ),
    inactiveMembershipMs: positiveOrDefault(
      windows.inactiveMembershipMs,
      defaultRetentionWindowsMs.inactiveMembershipMs,
    ),
    expiredMagicLinkMs: positiveOrDefault(
      windows.expiredMagicLinkMs,
      defaultRetentionWindowsMs.expiredMagicLinkMs,
    ),
    revokedCredentialMs: positiveOrDefault(
      windows.revokedCredentialMs,
      defaultRetentionWindowsMs.revokedCredentialMs,
    ),
    staleNotificationMs: positiveOrDefault(
      windows.staleNotificationMs,
      defaultRetentionWindowsMs.staleNotificationMs,
    ),
    staleRateLimitMs: positiveOrDefault(
      windows.staleRateLimitMs,
      defaultRetentionWindowsMs.staleRateLimitMs,
    ),
  };
}

export function isTerminalNotificationStatus(status: string): boolean {
  return status === "sent" || status === "failed" || status === "cancelled";
}

export function shouldRetireInactiveMembership(args: {
  role: "admin" | "member";
  emailIdentityId?: string;
  revokedAt?: number;
  updatedAt: number;
  tokenLastUsedAt?: number;
  hasAvailability: boolean;
  cutoff: number;
}): boolean {
  if (args.revokedAt !== undefined || args.role === "admin" || args.emailIdentityId) {
    return false;
  }
  if (args.hasAvailability) {
    return false;
  }
  return Math.max(args.updatedAt, args.tokenLastUsedAt ?? 0) <= args.cutoff;
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}
