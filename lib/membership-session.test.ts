import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetRememberedMembershipToken,
  readRememberedMembershipToken,
  rememberMembershipToken,
} from "./membership-session";

describe("membership session storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "ms_membership_team-planning=; Path=/; Max-Age=0; SameSite=Lax";
  });

  it("remembers a meeting membership token across refreshes", () => {
    rememberMembershipToken("team-planning", "member-secret-token");

    expect(readRememberedMembershipToken("team-planning")).toBe("member-secret-token");
    expect(document.cookie).toContain("ms_membership_team-planning=");
  });

  it("falls back to the membership cookie if local storage is unavailable", () => {
    rememberMembershipToken("team-planning", "member-secret-token");
    window.localStorage.clear();

    expect(readRememberedMembershipToken("team-planning")).toBe("member-secret-token");
  });

  it("forgets a stored membership token", () => {
    rememberMembershipToken("team-planning", "member-secret-token");
    forgetRememberedMembershipToken("team-planning");

    expect(readRememberedMembershipToken("team-planning")).toBeNull();
  });
});
