import { NextResponse } from "next/server";

export type RateLimitCheck = {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: number;
  retryAfterSeconds?: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export class RateLimitError extends Error {
  constructor(public readonly check: RateLimitCheck) {
    super("Too many requests.");
  }
}

export function evaluateRateLimit(args: {
  count: number;
  limit: number;
  now: number;
  resetAt: number;
  windowMs: number;
}): RateLimitCheck {
  const resetAt = args.resetAt <= args.now ? args.now + args.windowMs : args.resetAt;
  const count = args.resetAt <= args.now ? 1 : args.count + 1;
  const allowed = count <= args.limit;
  return {
    allowed,
    count,
    limit: args.limit,
    resetAt,
    retryAfterSeconds: allowed
      ? undefined
      : Math.max(1, Math.ceil((resetAt - args.now) / 1000)),
  };
}

export async function hashRateLimitKey(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value.trim().toLowerCase()),
  );
  return bytesToBase64Url(new Uint8Array(digest)).slice(0, 32);
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function enforceRequestRateLimit(args: {
  request: Request;
  scope: string;
  key?: string;
  limit: number;
  windowMs: number;
  now?: number;
}) {
  const key = args.key ?? getClientIp(args.request);
  const hashedKey = await hashRateLimitKey(`${args.scope}:${key}`);
  const now = args.now ?? Date.now();
  const bucketKey = `${args.scope}:${hashedKey}`;
  const existing = buckets.get(bucketKey);
  const check = evaluateRateLimit({
    count: existing?.count ?? 0,
    limit: args.limit,
    now,
    resetAt: existing?.resetAt ?? now,
    windowMs: args.windowMs,
  });
  buckets.set(bucketKey, { count: check.count, resetAt: check.resetAt });
  pruneExpiredBuckets(now);

  if (!check.allowed) {
    throw new RateLimitError(check);
  }
  return check;
}

export function rateLimitErrorResponse(error: RateLimitError) {
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: "Too many requests. Please wait before trying again.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(error.check.retryAfterSeconds ?? 60),
      },
    },
  );
}

export function resetInMemoryRateLimitsForTest(): void {
  buckets.clear();
}

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
