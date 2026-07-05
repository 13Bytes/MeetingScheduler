import { describe, expect, it } from "vitest";
import {
  assertApiCanEditMembershipAvailability,
  assertApiTokenHasScopes,
  normalizeApiTokenScopes,
  selectApiMembershipForMeeting,
} from "./agent-api";

describe("agent API authorization helpers", () => {
  it("deduplicates scopes and rejects empty API tokens", () => {
    expect(normalizeApiTokenScopes(["meetings:create", "meetings:create"])).toEqual([
      "meetings:create",
    ]);
    expect(() => normalizeApiTokenScopes([])).toThrow(/at least one/i);
  });

  it("rejects revoked tokens and missing scopes", () => {
    expect(() =>
      assertApiTokenHasScopes({ scopes: ["meetings:read"], revokedAt: 123 }, [
        "meetings:read",
      ]),
    ).toThrow(/invalid or revoked/i);
    expect(() =>
      assertApiTokenHasScopes({ scopes: ["meetings:read"] }, ["meetings:finalize"]),
    ).toThrow(/missing required scope: meetings:finalize/i);
  });

  it("prefers an admin membership when one API identity owns multiple memberships", () => {
    const meeting = {
      _id: "meeting-1",
      adminMode: "roleBased" as const,
      lifecycleState: "open" as const,
    };

    expect(
      selectApiMembershipForMeeting(
        [
          {
            _id: "member-1",
            meetingId: "meeting-1",
            role: "member",
          },
          {
            _id: "admin-1",
            meetingId: "meeting-1",
            role: "admin",
          },
        ],
        meeting,
      )?._id,
    ).toBe("admin-1");
  });

  it("ignores revoked memberships when resolving token-owner meeting authority", () => {
    expect(
      selectApiMembershipForMeeting(
        [
          {
            _id: "admin-1",
            meetingId: "meeting-1",
            role: "admin",
            revokedAt: 123,
          },
        ],
        {
          _id: "meeting-1",
          adminMode: "roleBased",
          lifecycleState: "open",
        },
      ),
    ).toBeNull();
  });

  it("allows availability writes only for an active membership owned by the token identity", () => {
    expect(() =>
      assertApiCanEditMembershipAvailability(
        {
          meetingId: "meeting-1",
          emailIdentityId: "email-1",
          role: "member",
        },
        {
          emailIdentityId: "email-1",
          meetingId: "meeting-1",
        },
      ),
    ).not.toThrow();

    expect(() =>
      assertApiCanEditMembershipAvailability(
        {
          meetingId: "meeting-1",
          emailIdentityId: "email-2",
          role: "member",
        },
        {
          emailIdentityId: "email-1",
          meetingId: "meeting-1",
        },
      ),
    ).toThrow(/cannot edit availability/i);
  });
});
