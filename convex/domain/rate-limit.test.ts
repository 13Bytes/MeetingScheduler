import { describe, expect, it } from "vitest";
import { evaluateDurableRateLimit, normalizeDurableRateLimitKey } from "./rate-limit";

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

  it("normalizes untrusted keys before persistence", () => {
    expect(normalizeDurableRateLimitKey("  Ada@Example.COM  ")).toBe("ada@example.com");
    expect(normalizeDurableRateLimitKey("")).toBe("unknown");
  });
});
