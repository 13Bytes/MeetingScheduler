import { describe, expect, it } from "vitest";
import {
  buildRetentionCutoffs,
  isTerminalNotificationStatus,
  shouldRetireInactiveMembership,
} from "./retention";

describe("retention policy helpers", () => {
  it("builds configurable retention cutoffs from the current time", () => {
    expect(
      buildRetentionCutoffs(1_000_000, {
        anonymousMeetingMs: 100,
        staleNotificationMs: 500,
      }),
    ).toMatchObject({
      anonymousMeetingBefore: 999_900,
      staleNotificationBefore: 999_500,
    });
  });

  it("only retires inactive anonymous non-admin memberships with no availability", () => {
    expect(
      shouldRetireInactiveMembership({
        role: "member",
        updatedAt: 1_000,
        hasAvailability: false,
        cutoff: 2_000,
      }),
    ).toBe(true);
    expect(
      shouldRetireInactiveMembership({
        role: "admin",
        updatedAt: 1_000,
        hasAvailability: false,
        cutoff: 2_000,
      }),
    ).toBe(false);
    expect(
      shouldRetireInactiveMembership({
        role: "member",
        emailIdentityId: "email-1",
        updatedAt: 1_000,
        hasAvailability: false,
        cutoff: 2_000,
      }),
    ).toBe(false);
  });

  it("recognizes terminal notification statuses for cleanup", () => {
    expect(isTerminalNotificationStatus("sent")).toBe(true);
    expect(isTerminalNotificationStatus("cancelled")).toBe(true);
    expect(isTerminalNotificationStatus("queued")).toBe(false);
  });
});
