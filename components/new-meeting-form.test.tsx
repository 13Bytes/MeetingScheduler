import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewMeetingForm } from "@/components/new-meeting-form";

describe("NewMeetingForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a meeting and redirects to the personal admin link", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "team-planning",
      adminMembershipToken: "admin-secret",
    });
    const onCreatedRedirect = vi.fn();

    render(
      <NewMeetingForm
        createMeeting={createMeeting}
        onCreatedRedirect={onCreatedRedirect}
      />,
    );

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

    await waitFor(() =>
      expect(onCreatedRedirect).toHaveBeenCalledWith(
        "http://localhost:3000/join/admin-secret",
      ),
    );
  });

  it("submits a trimmed optional recovery email", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "team-planning",
      adminMembershipToken: "admin-secret",
    });

    render(<NewMeetingForm createMeeting={createMeeting} assignLocation={vi.fn()} />);

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

  it("uses window.location.assign when no redirect callback is provided", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "team-planning",
      adminMembershipToken: "admin-secret",
    });
    const assign = vi.fn();

    render(<NewMeetingForm createMeeting={createMeeting} assignLocation={assign} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Team planning" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("http://localhost:3000/join/admin-secret"),
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

  it("keeps the exact-time calendar hidden until enabled", () => {
    render(<NewMeetingForm />);

    expect(
      screen.queryByRole("grid", { name: /creation allowed time calendar/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /choose exact times/i }));

    expect(
      screen.getByRole("grid", { name: /creation allowed time calendar/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell", { selected: true })[0]).toHaveClass(
      "bg-blue-500",
    );
  });

  it("submits exact times painted during creation", async () => {
    const createMeeting = vi.fn().mockResolvedValue({
      slug: "exact-times",
      adminMembershipToken: "admin-secret",
    });

    render(<NewMeetingForm createMeeting={createMeeting} assignLocation={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Exact times" },
    });
    fireEvent.change(screen.getByLabelText("Duration"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /choose exact times/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.keyDown(screen.getAllByRole("gridcell")[0]!, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /create meeting/i }));

    await waitFor(() => expect(createMeeting).toHaveBeenCalledTimes(1));
    const ranges = createMeeting.mock.calls[0]?.[0].settings.allowedTimeRanges;
    expect(ranges).toHaveLength(1);
    expect((Date.parse(ranges[0].endUtc) - Date.parse(ranges[0].startUtc)) / 60_000).toBe(
      30,
    );
  });

  it("reflects a custom range in the Constraint Calendar", async () => {
    render(<NewMeetingForm />);

    fireEvent.click(screen.getByRole("radio", { name: /custom range/i }));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-07-13" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-07-19" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "13:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "14:00" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /choose exact times/i }));

    await waitFor(() => {
      const calendar = screen.getByRole("grid", {
        name: /creation allowed time calendar/i,
      });
      const selectedCells = screen.getAllByRole("gridcell", { selected: true });
      expect(selectedCells.length).toBeGreaterThan(0);
      expect(
        selectedCells.every((cell) =>
          /13:00|13:30/u.test(cell.getAttribute("aria-label") ?? ""),
        ),
      ).toBe(true);
      expect(within(calendar).getByText("07-13")).toBeInTheDocument();
      expect(within(calendar).getByText("07-19")).toBeInTheDocument();
      expect(within(calendar).queryByText("07-12")).not.toBeInTheDocument();
      expect(within(calendar).queryByText("07-20")).not.toBeInTheDocument();
    });
  });

  it("lets custom ranges target individual days of the week", async () => {
    render(<NewMeetingForm />);

    fireEvent.click(screen.getByRole("radio", { name: /custom range/i }));
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-07-13" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-07-19" },
    });
    for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      fireEvent.click(screen.getByLabelText(weekday));
    }
    fireEvent.click(screen.getByLabelText("Sat"));
    fireEvent.click(screen.getByRole("checkbox", { name: /choose exact times/i }));

    await waitFor(() => {
      const selectedCells = screen.getAllByRole("gridcell", { selected: true });
      expect(selectedCells.length).toBeGreaterThan(0);
      expect(
        selectedCells.every((cell) =>
          /^Sat /u.test(cell.getAttribute("aria-label") ?? ""),
        ),
      ).toBe(true);
    });
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
