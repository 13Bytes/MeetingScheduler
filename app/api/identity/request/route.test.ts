import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resetInMemoryRateLimitsForTest } from "@/lib/rate-limit";

const { mutationMock, sendMock } = vi.hoisted(() => ({
  mutationMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(function ConvexHttpClient() {
    return {
      mutation: mutationMock,
    };
  }),
}));

vi.mock("@/lib/identity-internal", () => ({
  getConvexUrl: () => "https://convex.example.com",
  getInternalIdentitySecret: () => "internal-secret",
}));

vi.mock("@/lib/email/adapter", () => ({
  createEmailDeliveryAdapter: () => ({
    provider: "development",
    send: sendMock,
  }),
  getConfiguredEmailFrom: () => "Meeting Scheduler <dev@example.invalid>",
}));

describe("identity verification email request route", () => {
  beforeEach(() => {
    resetInMemoryRateLimitsForTest();
    vi.unstubAllEnvs();
    mutationMock.mockReset();
    sendMock.mockReset();
    delete process.env.MEETING_SCHEDULER_APP_URL;
  });

  it("sends the magic link through the email adapter without returning the raw token", async () => {
    process.env.MEETING_SCHEDULER_APP_URL = "https://app.example.com";
    mutationMock
      .mockResolvedValueOnce({
        notificationOutboxId: "notification-1",
        normalizedEmail: "ada@example.com",
        rawMagicLinkToken: "raw-secret-token",
        tokenFingerprint: "fingerprint-1",
        expiresAt: Date.parse("2026-07-02T10:00:00.000Z"),
        deliveryQueued: true,
      })
      .mockResolvedValueOnce({ status: "sent" });
    sendMock.mockResolvedValueOnce({
      provider: "development",
      providerMessageId: "dev_123",
    });

    const response = await POST(
      new Request("https://untrusted.example.net/api/identity/request", {
        method: "POST",
        body: JSON.stringify({ email: "Ada@Example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deliveryQueued: true,
      tokenFingerprint: "fingerprint-1",
      expiresAt: Date.parse("2026-07-02T10:00:00.000Z"),
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        text: expect.stringContaining(
          "https://app.example.com/identity/verify?token=raw-secret-token",
        ),
      }),
      { idempotencyKey: "notification:notification-1:fingerprint-1" },
    );
    expect(JSON.stringify(body)).not.toContain("raw-secret-token");
    expect(mutationMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        notificationId: "notification-1",
        provider: "development",
        providerMessageId: "dev_123",
      }),
    );
  });

  it("requires an explicit app URL before minting production magic links", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(
      new Request("https://attacker.example.net/api/identity/request", {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/MEETING_SCHEDULER_APP_URL is required/);
    expect(mutationMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns success when sent-status recording fails after delivery", async () => {
    process.env.MEETING_SCHEDULER_APP_URL = "https://app.example.com";
    mutationMock
      .mockResolvedValueOnce({
        notificationOutboxId: "notification-1",
        normalizedEmail: "ada@example.com",
        rawMagicLinkToken: "raw-secret-token",
        tokenFingerprint: "fingerprint-1",
        expiresAt: Date.parse("2026-07-02T10:00:00.000Z"),
        deliveryQueued: true,
      })
      .mockRejectedValueOnce(new Error("mark sent failed"));
    sendMock.mockResolvedValueOnce({
      provider: "development",
      providerMessageId: "dev_123",
    });

    const response = await POST(
      new Request("https://app.example.com/api/identity/request", {
        method: "POST",
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deliveryQueued: true,
      tokenFingerprint: "fingerprint-1",
      expiresAt: Date.parse("2026-07-02T10:00:00.000Z"),
    });
    expect(sendMock).toHaveBeenCalledOnce();
    expect(mutationMock).toHaveBeenCalledTimes(2);
  });
});
