import { describe, expect, it } from "vitest";
import {
  buildExpiredUserSessionCookie,
  buildUserSessionCookie,
  createUserSession,
  userSessionCookieName,
  verifyUserSession,
} from "./user-session";

const secret = "a-test-secret-that-is-long-enough-for-hmac";

describe("user session cookies", () => {
  it("signs and verifies a bounded user session", () => {
    const token = createUserSession(
      {
        userId: "user-123",
        now: 10_000,
        maxAgeSeconds: 60,
      },
      secret,
    );

    expect(verifyUserSession(token, secret, 10_500)).toMatchObject({
      userId: "user-123",
      issuedAt: 10_000,
      expiresAt: 70_000,
    });
  });

  it("rejects tampered and expired sessions", () => {
    const token = createUserSession(
      {
        userId: "user-123",
        now: 10_000,
        maxAgeSeconds: 1,
      },
      secret,
    );

    expect(verifyUserSession(`${token}x`, secret, 10_500)).toBeNull();
    expect(verifyUserSession(token, secret, 11_001)).toBeNull();
  });

  it("builds scoped HttpOnly cookie headers", () => {
    expect(buildUserSessionCookie("abc", { secure: true })).toContain(
      `${userSessionCookieName}=abc; Path=/; HttpOnly; SameSite=Lax;`,
    );
    expect(buildUserSessionCookie("abc", { secure: true })).toContain("Secure");
    expect(buildExpiredUserSessionCookie()).toContain("Max-Age=0");
  });
});
