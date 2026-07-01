import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewMeetingForm } from "@/components/new-meeting-form";

describe("NewMeetingForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a meeting and shows personal admin plus public links", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "team-planning",
      adminMembershipToken: "admin-secret",
    });

    render(<NewMeetingForm createMeeting={createMeeting} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Team planning" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    await waitFor(() => expect(createMeeting).toHaveBeenCalledTimes(1));
    expect(createMeeting.mock.calls[0]?.[0]).not.toHaveProperty("creatorEmail");
    expect(createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Team planning",
        creatorPrivacyMode: "detailed",
        adminMode: "roleBased",
        settings: expect.objectContaining({
          durationMinutes: 60,
          granularityMinutes: 30,
          allowedTimeRanges: expect.any(Array),
        }),
      }),
    );

    expect(
      await screen.findByDisplayValue("http://localhost:3000/join/admin-secret"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("http://localhost:3000/m/team-planning"),
    ).toBeInTheDocument();
  });

  it("submits a trimmed optional recovery email", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "team-planning",
      adminMembershipToken: "admin-secret",
    });

    render(<NewMeetingForm createMeeting={createMeeting} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Team planning" },
    });
    fireEvent.change(screen.getByLabelText(/recovery email/i), {
      target: { value: "  Ada@Example.COM  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    await waitFor(() => expect(createMeeting).toHaveBeenCalledTimes(1));
    expect(createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorEmail: "Ada@Example.COM",
      }),
    );
  });

  it("keeps submission client-side when duration does not align to granularity", () => {
    const createMeeting = vi.fn();

    render(<NewMeetingForm createMeeting={createMeeting} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Odd meeting" },
    });
    fireEvent.change(screen.getByLabelText("Duration"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Granularity"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    expect(createMeeting).not.toHaveBeenCalled();
    expect(screen.getByText(/duration must be a multiple/i)).toBeInTheDocument();
  });

  it("blocks allowed ranges that cannot fit the meeting duration", () => {
    const createMeeting = vi.fn();

    render(<NewMeetingForm createMeeting={createMeeting} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Long workshop" },
    });
    fireEvent.change(screen.getByLabelText("Duration"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /custom range/i }));
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    expect(createMeeting).not.toHaveBeenCalled();
    expect(screen.getByText(/at least as long as the meeting/i)).toBeInTheDocument();
  });

  it("shows a configuration message without a Convex mutation", () => {
    render(<NewMeetingForm />);

    expect(screen.getByRole("button", { name: /create meeting/i })).toBeDisabled();
    expect(screen.getByText(/NEXT_PUBLIC_CONVEX_URL/u)).toBeInTheDocument();
  });

  it("normalizes time zone aliases for stable hydration", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue([
      "Africa/Asmera",
      "Europe/Berlin",
    ]);

    render(<NewMeetingForm />);

    expect(screen.getByRole("option", { name: "Africa/Asmara" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Africa/Asmera" }),
    ).not.toBeInTheDocument();
  });
});
