import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("remembers a meeting membership token in local storage across refreshes", () => {
    rememberMembershipToken("team-planning", "member-secret-token");

    expect(readRememberedMembershipToken("team-planning")).toBe("member-secret-token");
    expect(document.cookie).not.toContain("ms_membership_team-planning=");
  });

  it("writes and reads the membership cookie if local storage is unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    rememberMembershipToken("team-planning", "member-secret-token");
    setItem.mockRestore();
    window.localStorage.clear();

    expect(document.cookie).toContain("ms_membership_team-planning=");
    expect(readRememberedMembershipToken("team-planning")).toBe("member-secret-token");
  });

  it("forgets a stored membership token", () => {
    rememberMembershipToken("team-planning", "member-secret-token");
    forgetRememberedMembershipToken("team-planning");

    expect(readRememberedMembershipToken("team-planning")).toBeNull();
  });
});
