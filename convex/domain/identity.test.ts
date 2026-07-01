import { describe, expect, it } from "vitest";
import {
  assertCanAttachEmailIdentityToMembership,
  assertMagicLinkCanBeConsumed,
  assertVerifiedEmailIdentity,
  filterRecoverableDashboardMemberships,
  isMembershipRecoverable,
  normalizeMagicLinkExpiry,
} from "./identity";

describe("passwordless identity domain helpers", () => {
  it("defaults magic links to a bounded future expiry", () => {
    expect(normalizeMagicLinkExpiry({ now: 1_000 })).toBe(1_801_000);
  });

  it("rejects expired and overlong magic link expiries", () => {
    expect(() =>
      normalizeMagicLinkExpiry({ now: 1_000, requestedExpiresAt: 999 }),
    ).toThrow(/future/i);
    expect(() =>
      normalizeMagicLinkExpiry({
        now: 1_000,
        requestedExpiresAt: 1_000 + 31 * 60 * 1000,
      }),
    ).toThrow(/maximum/i);
  });

  it("allows valid magic links and rejects expired or consumed links", () => {
    expect(() => assertMagicLinkCanBeConsumed({ expiresAt: 2_000 }, 1_000)).not.toThrow();
    expect(() =>
      assertMagicLinkCanBeConsumed({ expiresAt: 2_000, consumedAt: 1_500 }, 1_000),
    ).toThrow(/invalid or expired/i);
    expect(() => assertMagicLinkCanBeConsumed({ expiresAt: 1_000 }, 1_000)).toThrow(
      /invalid or expired/i,
    );
  });

  it("requires a verified email identity before privileged recovery", () => {
    expect(() => assertVerifiedEmailIdentity({ verifiedAt: 123 })).not.toThrow();
    expect(() => assertVerifiedEmailIdentity({})).toThrow(/verified/i);
  });

  it("does not allow replacing an attached membership identity", () => {
    expect(() =>
      assertCanAttachEmailIdentityToMembership({
        membership: {},
        emailIdentityId: "email-1",
      }),
    ).not.toThrow();
    expect(() =>
      assertCanAttachEmailIdentityToMembership({
        membership: { emailIdentityId: "email-1" },
        emailIdentityId: "email-1",
      }),
    ).not.toThrow();
    expect(() =>
      assertCanAttachEmailIdentityToMembership({
        membership: { emailIdentityId: "email-2" },
        emailIdentityId: "email-1",
      }),
    ).toThrow(/another email identity/i);
  });

  it("filters dashboard memberships to active admin or submitted-response rows", () => {
    expect(
      filterRecoverableDashboardMemberships([
        {
          _id: "member-empty",
          meetingId: "meeting-1",
          role: "member",
          updatedAt: 1,
          hasAvailability: false,
        },
        {
          _id: "admin",
          meetingId: "meeting-2",
          role: "admin",
          updatedAt: 2,
          hasAvailability: false,
        },
        {
          _id: "responded",
          meetingId: "meeting-3",
          role: "member",
          updatedAt: 3,
          hasAvailability: true,
        },
        {
          _id: "revoked",
          meetingId: "meeting-4",
          role: "admin",
          updatedAt: 4,
          revokedAt: 5,
          hasAvailability: true,
        },
      ]).map((membership) => membership._id),
    ).toEqual(["responded", "admin"]);
  });

  it("applies dashboard recovery eligibility to direct link recovery", () => {
    expect(isMembershipRecoverable({ role: "admin", hasAvailability: false })).toBe(true);
    expect(isMembershipRecoverable({ role: "member", hasAvailability: true })).toBe(true);
    expect(isMembershipRecoverable({ role: "member", hasAvailability: false })).toBe(
      false,
    );
    expect(
      isMembershipRecoverable({
        role: "admin",
        hasAvailability: true,
        revokedAt: 123,
      }),
    ).toBe(false);
  });
});
