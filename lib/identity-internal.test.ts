import { describe, expect, it } from "vitest";
import { getConvexUrl, getInternalIdentitySecret } from "./identity-internal";

describe("internal identity configuration", () => {
  it("uses configured internal secrets and rejects missing production secrets", () => {
    expect(
      getInternalIdentitySecret({
        MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET: "shared-secret",
        NODE_ENV: "production",
      }),
    ).toBe("shared-secret");
    expect(() => getInternalIdentitySecret({ NODE_ENV: "production" })).toThrow(
      /required/i,
    );
    expect(() => getInternalIdentitySecret({ NODE_ENV: "development" })).toThrow(
      /required/i,
    );
    expect(
      getInternalIdentitySecret({
        NODE_ENV: "development",
        MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET: "true",
      }),
    ).toContain("dev-only");
  });

  it("requires a Convex URL for server identity routes", () => {
    expect(
      getConvexUrl({
        NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
      }),
    ).toBe("https://example.convex.cloud");
    expect(() => getConvexUrl({})).toThrow(/NEXT_PUBLIC_CONVEX_URL/i);
  });
});
