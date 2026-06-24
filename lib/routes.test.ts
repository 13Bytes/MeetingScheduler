import { describe, expect, it } from "vitest";
import { routes, routeMap } from "@/lib/routes";

describe("routes", () => {
  it("builds secret-link paths", () => {
    expect(routes.meetingAdmin("planning", "admin-secret")).toBe(
      "/m/planning/admin/admin-secret",
    );
    expect(routes.membershipLink("member-secret")).toBe("/join/member-secret");
  });

  it("encodes dynamic route segments", () => {
    expect(routes.meetingPoll("team planning/Q3")).toBe("/m/team%20planning%2FQ3");
    expect(routes.meetingAdmin("team planning", "admin?secret#1")).toBe(
      "/m/team%20planning/admin/admin%3Fsecret%231",
    );
    expect(routes.membershipLink("member secret/1")).toBe("/join/member%20secret%2F1");
  });

  it("documents the Stage 0 route placeholders", () => {
    expect(routeMap.map((route) => route.path)).toEqual([
      "/",
      "/new",
      "/m/[meetingSlug]",
      "/m/[meetingSlug]/admin/[adminToken]",
      "/join/[membershipToken]",
    ]);
  });
});
