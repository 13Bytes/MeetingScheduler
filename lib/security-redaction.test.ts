import { describe, expect, it } from "vitest";
import { redactSecrets, safeErrorMessage } from "./security-redaction";

describe("security redaction", () => {
  it("redacts bearer, membership, magic-link, api, and hash material", () => {
    const redacted = redactSecrets(
      "Bearer ms_api_secret ms_member_secret ms_magic_secret sha256:abc123 sk-secret",
    );

    expect(redacted).not.toContain("ms_api_secret");
    expect(redacted).not.toContain("ms_member_secret");
    expect(redacted).not.toContain("ms_magic_secret");
    expect(redacted).not.toContain("sha256:abc123");
    expect(redacted).not.toContain("sk-secret");
  });

  it("normalizes unknown errors to a fallback", () => {
    expect(safeErrorMessage("nope", "fallback")).toBe("fallback");
  });
});
