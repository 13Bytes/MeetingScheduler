import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalDeliveredEmails,
  createEmailDeliveryAdapter,
  getConfiguredEmailFrom,
  getLocalDeliveredEmails,
} from "./adapter";

describe("email delivery adapter", () => {
  afterEach(() => {
    clearLocalDeliveredEmails();
    vi.restoreAllMocks();
  });

  it("uses the development adapter by default and deduplicates idempotency keys", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const adapter = createEmailDeliveryAdapter({ NODE_ENV: "development" });
    const message = {
      to: "ada@example.com",
      from: getConfiguredEmailFrom({}),
      subject: "Hello",
      text: "secret-ish local body",
    };

    const first = await adapter.send(message, { idempotencyKey: "same-key" });
    const second = await adapter.send(message, { idempotencyKey: "same-key" });

    expect(first.provider).toBe("development");
    expect(second).toMatchObject({
      providerMessageId: first.providerMessageId,
      duplicate: true,
    });
    expect(getLocalDeliveredEmails()).toHaveLength(1);
    expect(info.mock.calls.flat().join("\n")).not.toContain("secret-ish local body");
  });

  it("requires provider configuration in production", () => {
    expect(() => createEmailDeliveryAdapter({ NODE_ENV: "production" })).toThrow(
      /api_key|email_provider_api_key/i,
    );
  });

  it("sends through Resend with an idempotency key", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ id: "email_123" }, { status: 200 }),
    );
    const adapter = createEmailDeliveryAdapter(
      {
        MEETING_SCHEDULER_EMAIL_PROVIDER: "resend",
        EMAIL_FROM: "Meetings <meetings@example.com>",
        RESEND_API_KEY: "test-key",
      },
      fetchImpl as typeof fetch,
    );

    const result = await adapter.send(
      {
        to: "ada@example.com",
        from: "Meetings <meetings@example.com>",
        subject: "Hello",
        text: "Body",
      },
      { idempotencyKey: "notification:1" },
    );

    expect(result).toEqual({ provider: "resend", providerMessageId: "email_123" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "notification:1",
        }),
      }),
    );
  });
});
