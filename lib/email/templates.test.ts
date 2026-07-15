import { describe, expect, it } from "vitest";
import {
  buildLifecycleEmailUrls,
  renderMeetingLifecycleEmail,
  renderPasswordlessEmail,
} from "./templates";

describe("email templates", () => {
  it("renders a passwordless verification link", () => {
    const email = renderPasswordlessEmail({
      purpose: "emailVerification",
      to: "ada@example.com",
      from: "Meetings <meetings@example.com>",
      magicLinkUrl: "https://app.example.com/identity/verify?token=abc",
      expiresAt: Date.parse("2026-07-02T10:00:00.000Z"),
    });

    expect(email.subject).toMatch(/verify your email/i);
    expect(email.text).toContain("https://app.example.com/identity/verify?token=abc");
    expect(email.text).toContain("expires");
  });

  it("renders finalized and reopened lifecycle notifications", () => {
    const finalized = renderMeetingLifecycleEmail({
      kind: "meeting.finalized",
      to: "ada@example.com",
      meetingTitle: "Research Sync",
      meetingUrl: "https://app.example.com/m/research-sync",
      dashboardUrl: "https://app.example.com/identity/dashboard",
      finalizedSlot: {
        startUtc: "2026-07-02T08:00:00.000Z",
        endUtc: "2026-07-02T09:00:00.000Z",
        timeZone: "UTC",
      },
    });
    const reopened = renderMeetingLifecycleEmail({
      kind: "meeting.reopened",
      to: "ada@example.com",
      meetingTitle: "Research Sync",
      meetingUrl: "https://app.example.com/m/research-sync",
      dashboardUrl: "https://app.example.com/identity/dashboard",
    });

    expect(finalized.subject).toBe("Final time selected: Research Sync");
    expect(finalized.text).toContain("Selected time:");
    expect(finalized.text).toContain("An organizer finalized this meeting.");
    expect(reopened.subject).toBe("Meeting reopened: Research Sync");
    expect(reopened.text).toContain(
      "An organizer reopened this meeting for more responses.",
    );
  });

  it("builds absolute lifecycle URLs", () => {
    expect(
      buildLifecycleEmailUrls({
        appOrigin: "https://app.example.com",
        meetingSlug: "research sync",
      }),
    ).toEqual({
      meetingUrl: "https://app.example.com/m/research%20sync",
      dashboardUrl: "https://app.example.com/identity/dashboard",
    });
  });

  it("escapes HTML-sensitive content in lifecycle messages", () => {
    const email = renderMeetingLifecycleEmail({
      kind: "meeting.reopened",
      to: "ada@example.com",
      meetingTitle: "A <B>",
      meetingUrl: "https://app.example.com/m/a?x='`",
      dashboardUrl: "https://app.example.com/identity/dashboard",
    });

    expect(email.html).toContain("x=&#39;&#96;");
  });
});
