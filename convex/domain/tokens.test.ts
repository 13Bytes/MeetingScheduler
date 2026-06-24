import { describe, expect, it } from "vitest";
import { createSecretToken, hashSecretToken, tokenFingerprintFromHash } from "./tokens";

describe("secret token handling", () => {
  it("creates membership tokens and stores only hash-derived material", async () => {
    const token = await createSecretToken("membership");

    expect(token.rawToken).toMatch(/^ms_member_[A-Za-z0-9_-]+$/u);
    expect(token.tokenHash).toMatch(/^sha256:[A-Za-z0-9_-]+$/u);
    expect(token.tokenHash).not.toContain(token.rawToken);
    expect(token.tokenFingerprint).toBe(tokenFingerprintFromHash(token.tokenHash));
  });

  it("hashes the same token consistently without preserving raw token material", async () => {
    const rawToken = "ms_member_test-secret";
    const firstHash = await hashSecretToken(rawToken);
    const secondHash = await hashSecretToken(` ${rawToken} `);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toContain(rawToken);
  });

  it("generates different tokens for independent calls", async () => {
    const firstToken = await createSecretToken("magicLink");
    const secondToken = await createSecretToken("magicLink");

    expect(firstToken.rawToken).not.toBe(secondToken.rawToken);
    expect(firstToken.tokenHash).not.toBe(secondToken.tokenHash);
    expect(firstToken.tokenFingerprint).not.toBe(secondToken.tokenFingerprint);
  });

  it("rejects blank tokens before hashing", async () => {
    await expect(hashSecretToken("   ")).rejects.toThrow(/Secret token cannot be blank/u);
  });
});
