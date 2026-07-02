import { describe, expect, it } from "vitest";
import {
  buildExpiredIdentitySessionCookie,
  buildIdentitySessionCookie,
  createEmailIdentitySession,
  getIdentitySessionSecret,
  identitySessionCookieName,
  verifyEmailIdentitySession,
} from "./identity-session";

const secret = "a-test-secret-that-is-long-enough-for-hmac";

describe("identity session cookies", () => {
  it("signs and verifies a bounded email identity session", () => {
    const token = createEmailIdentitySession(
      {
        emailIdentityId: "email-123",
        now: 10_000,
        maxAgeSeconds: 60,
      },
      secret,
    );

    expect(verifyEmailIdentitySession(token, secret, 10_500)).toMatchObject({
      emailIdentityId: "email-123",
      issuedAt: 10_000,
      expiresAt: 70_000,
    });
  });

  it("rejects tampered and expired sessions", () => {
    const token = createEmailIdentitySession(
      {
        emailIdentityId: "email-123",
        now: 10_000,
        maxAgeSeconds: 1,
      },
      secret,
    );

    expect(verifyEmailIdentitySession(`${token}x`, secret, 10_500)).toBeNull();
    expect(verifyEmailIdentitySession(token, secret, 11_001)).toBeNull();
  });

  it("builds scoped HttpOnly cookie headers", () => {
    expect(buildIdentitySessionCookie("abc", { secure: true })).toContain(
      `${identitySessionCookieName}=abc; Path=/; HttpOnly; SameSite=Lax;`,
    );
    expect(buildIdentitySessionCookie("abc", { secure: true })).toContain("Secure");
    expect(buildExpiredIdentitySessionCookie()).toContain("Max-Age=0");
  });

  it("requires an explicit session secret in production", () => {
    expect(() => getIdentitySessionSecret({ NODE_ENV: "production" })).toThrow(
      /required/i,
    );
    expect(
      getIdentitySessionSecret({
        NODE_ENV: "development",
      }),
    ).toContain("dev-only");
  });
});
