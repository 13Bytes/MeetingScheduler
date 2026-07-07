import { describe, expect, it } from "vitest";
import {
  buildAbsoluteAppUrl,
  buildCreatedMeetingLinks,
  routes,
  routeMap,
} from "@/lib/routes";

describe("routes", () => {
  it("builds secret-link paths", () => {
    expect(routes.membershipLink("member-secret")).toBe("/join/member-secret");
  });

  it("encodes dynamic route segments", () => {
    expect(routes.meetingPoll("team planning/Q3")).toBe("/m/team%20planning%2FQ3");
    expect(routes.membershipLink("member secret/1")).toBe("/join/member%20secret%2F1");
    expect(routes.adminInvite("team planning/Q3", "admin invite/1")).toBe(
      "/m/team%20planning%2FQ3#adminInviteToken=admin+invite%2F1",
    );
  });

  it("builds absolute public and admin membership links", () => {
    expect(
      buildCreatedMeetingLinks({
        origin: "https://scheduler.example/app",
        meetingSlug: "team planning",
        adminMembershipToken: "admin secret/1",
      }),
    ).toEqual({
      publicParticipantUrl: "https://scheduler.example/m/team%20planning",
      adminMembershipUrl: "https://scheduler.example/join/admin%20secret%2F1",
    });
  });

  it("rejects non-app paths for absolute URLs", () => {
    expect(() => buildAbsoluteAppUrl("m/planning", "https://example.com")).toThrow(
      /start with \//u,
    );
  });

  it("documents the current route map", () => {
    expect(routeMap.map((route) => route.path)).toEqual([
      "/",
      "/new",
      "/identity",
      "/identity/dashboard",
      "/m/[meetingSlug]",
      "/join/[membershipToken]",
    ]);
  });
});
