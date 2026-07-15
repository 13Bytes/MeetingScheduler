import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatedMeetingHandoff } from "@/components/created-meeting-handoff";

describe("CreatedMeetingHandoff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the share and private organizer links before continuing", async () => {
    render(
      <CreatedMeetingHandoff
        meetingSlug="team-planning"
        adminMembershipToken="admin-secret"
      />,
    );

    expect(
      await screen.findByRole("textbox", { name: /participant invitation/i }),
    ).toHaveValue("http://localhost:3000/m/team-planning");
    expect(
      screen.getByRole("textbox", { name: /private organizer link/i }),
    ).toHaveValue("http://localhost:3000/join/admin-secret");
    expect(screen.getByRole("link", { name: /continue to meeting/i })).toHaveAttribute(
      "href",
      "/join/admin-secret",
    );
  });

  it("copies a meeting link and confirms the action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CreatedMeetingHandoff
        meetingSlug="team-planning"
        adminMembershipToken="admin-secret"
      />,
    );

    const copyButton = await screen.findByRole("button", {
      name: /copy participant invitation/i,
    });
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("http://localhost:3000/m/team-planning"),
    );
    expect(
      screen.getByRole("button", { name: /copied participant invitation/i }),
    ).toBeInTheDocument();
  });
});
