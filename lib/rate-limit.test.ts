import { beforeEach, describe, expect, it } from "vitest";
import {
  enforceRequestRateLimit,
  evaluateRateLimit,
  getClientIp,
  RateLimitError,
  resetInMemoryRateLimitsForTest,
} from "./rate-limit";

describe("rate-limit helpers", () => {
  beforeEach(() => resetInMemoryRateLimitsForTest());

  it("allows requests until the configured window limit is exceeded", () => {
    expect(
      evaluateRateLimit({
        count: 1,
        limit: 2,
        now: 1_000,
        resetAt: 61_000,
        windowMs: 60_000,
      }),
    ).toMatchObject({ allowed: true, count: 2, resetAt: 61_000 });

    expect(
      evaluateRateLimit({
        count: 2,
        limit: 2,
        now: 2_000,
        resetAt: 61_000,
        windowMs: 60_000,
      }),
    ).toMatchObject({ allowed: false, count: 3, retryAfterSeconds: 59 });
  });

  it("resets buckets after the window elapses", () => {
    expect(
      evaluateRateLimit({
        count: 20,
        limit: 2,
        now: 61_000,
        resetAt: 60_000,
        windowMs: 60_000,
      }),
    ).toMatchObject({ allowed: true, count: 1, resetAt: 121_000 });
  });

  it("throws a stable RateLimitError for repeated in-memory requests", async () => {
    const request = new Request("https://app.example.com/api/test", {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });

    await enforceRequestRateLimit({
      request,
      scope: "test",
      limit: 1,
      windowMs: 60_000,
      now: 1_000,
    });

    await expect(
      enforceRequestRateLimit({
        request,
        scope: "test",
        limit: 1,
        windowMs: 60_000,
        now: 2_000,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("ignores spoofable forwarding headers unless the deployment is trusted", () => {
    const request = new Request("https://app.example.com", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });
    expect(getClientIp(request, { NODE_ENV: "production" })).toBe("unknown");
    expect(
      getClientIp(request, {
        NODE_ENV: "production",
        MEETING_SCHEDULER_TRUST_PROXY_HEADERS: "true",
      }),
    ).toBe("203.0.113.1");
  });
});
