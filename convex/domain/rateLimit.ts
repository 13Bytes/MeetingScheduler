export type DurableRateLimitState = {
  count: number;
  windowStartedAt: number;
};

export type DurableRateLimitDecision = {
  allowed: boolean;
  count: number;
  windowStartedAt: number;
  expiresAt: number;
  retryAfterMs?: number;
};

export function evaluateDurableRateLimit(args: {
  existing?: DurableRateLimitState | null;
  limit: number;
  now: number;
  windowMs: number;
}): DurableRateLimitDecision {
  const existing = args.existing;
  const startsNewWindow =
    !existing || existing.windowStartedAt + args.windowMs <= args.now;
  const windowStartedAt = startsNewWindow ? args.now : existing.windowStartedAt;
  const count = startsNewWindow ? 1 : existing.count + 1;
  const expiresAt = windowStartedAt + args.windowMs;
  const allowed = count <= args.limit;

  return {
    allowed,
    count,
    windowStartedAt,
    expiresAt,
    retryAfterMs: allowed ? undefined : Math.max(1, expiresAt - args.now),
  };
}

export function normalizeDurableRateLimitKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}
