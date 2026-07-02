import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { queryMock, mutationMock, sendMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  mutationMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(function ConvexHttpClient() {
    return {
      query: queryMock,
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

describe("notification outbox processor route", () => {
  beforeEach(() => {
    queryMock.mockReset();
    mutationMock.mockReset();
    sendMock.mockReset();
    delete process.env.MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET;
    delete process.env.MEETING_SCHEDULER_APP_URL;
  });

  it("claims queued lifecycle notifications and marks successful sends", async () => {
    process.env.MEETING_SCHEDULER_APP_URL = "https://app.example.com";
    queryMock.mockResolvedValueOnce({ notificationIds: ["notification-1"] });
    mutationMock
      .mockResolvedValueOnce({
        status: "claimed",
        notification: {
          _id: "notification-1",
          kind: "meeting.finalized",
          dedupeKey: "meeting.finalized:meeting-1:2:email-1",
          attempts: 1,
          payload: {
            startUtc: "2026-07-02T08:00:00.000Z",
            endUtc: "2026-07-02T09:00:00.000Z",
            timeZone: "UTC",
          },
        },
        meeting: { title: "Research Sync", slug: "research-sync" },
        recipient: { normalizedEmail: "ada@example.com" },
      })
      .mockResolvedValueOnce({ status: "sent" });
    sendMock.mockResolvedValueOnce({
      provider: "development",
      providerMessageId: "dev_123",
    });

    const response = await POST(
      new NextRequest("https://localhost/api/notifications/process", {
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      processed: 1,
      results: [{ notificationId: "notification-1", status: "sent" }],
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@example.com",
        subject: "Final time selected: Research Sync",
        text: expect.stringContaining("https://app.example.com/m/research-sync"),
      }),
      { idempotencyKey: "meeting.finalized:meeting-1:2:email-1" },
    );
    expect(mutationMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        notificationId: "notification-1",
        provider: "development",
        providerMessageId: "dev_123",
      }),
    );
  });

  it("requires the processor secret when configured", async () => {
    process.env.MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET = "secret";

    const response = await POST(
      new NextRequest("https://localhost/api/notifications/process", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
