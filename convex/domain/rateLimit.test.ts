import { describe, expect, it } from "vitest";
import { evaluateDurableRateLimit, normalizeDurableRateLimitKey } from "./rateLimit";

describe("durable rate-limit helpers", () => {
  it("increments an active durable bucket and reports retry timing", () => {
    expect(
      evaluateDurableRateLimit({
        existing: { count: 2, windowStartedAt: 1_000 },
        limit: 2,
        now: 2_000,
        windowMs: 60_000,
      }),
    ).toEqual({
      allowed: false,
      count: 3,
      windowStartedAt: 1_000,
      expiresAt: 61_000,
      retryAfterMs: 59_000,
    });
  });

  it("increments instead of resetting when existing window starts at the same millisecond", () => {
    expect(
      evaluateDurableRateLimit({
        existing: { count: 1, windowStartedAt: 1_000 },
        limit: 2,
        now: 1_000,
        windowMs: 60_000,
      }),
    ).toEqual({
      allowed: true,
      count: 2,
      windowStartedAt: 1_000,
      expiresAt: 61_000,
      retryAfterMs: undefined,
    });
  });

  it("normalizes untrusted keys before persistence", () => {
    expect(normalizeDurableRateLimitKey("  Ada@Example.COM  ")).toBe("ada@example.com");
    expect(normalizeDurableRateLimitKey("")).toBe("unknown");
  });
});
