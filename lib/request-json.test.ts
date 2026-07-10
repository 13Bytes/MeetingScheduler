import { describe, expect, it } from "vitest";
import { maxJsonRequestBytes, readBoundedJsonObject } from "./request-json";

describe("bounded JSON request parsing", () => {
  it("parses object bodies", async () => {
    await expect(
      readBoundedJsonObject<{ ok: boolean }>(
        new Request("https://example.com", { method: "POST", body: '{"ok":true}' }),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects oversized and non-object bodies", async () => {
    await expect(
      readBoundedJsonObject(
        new Request("https://example.com", {
          method: "POST",
          body: "x".repeat(maxJsonRequestBytes + 1),
        }),
      ),
    ).rejects.toThrow(/too large/u);
    await expect(
      readBoundedJsonObject(
        new Request("https://example.com", { method: "POST", body: "[]" }),
      ),
    ).rejects.toThrow(/JSON object/u);
  });
});
