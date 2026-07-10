import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminCalendarPainter } from "@/components/admin-calendar-painter";

const editableData = {
  meeting: {
    title: "Team planning",
    lifecycleState: "open" as const,
    adminMode: "roleBased" as const,
    canonicalTimeZone: "Europe/Berlin",
    granularityMinutes: 30,
    durationMinutes: 60,
    allowedTimeRanges: [
      {
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T15:00:00.000Z",
        timeZone: "Europe/Berlin",
      },
    ],
  },
  membership: {
    role: "admin" as const,
  },
  capabilities: {
    canAdminister: true,
    canReopen: false,
  },
};

describe("AdminCalendarPainter", () => {
  it("saves shortcut-painted allowed regions", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminCalendarPainter
        data={editableData}
        onSave={onSave}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fill weekdays 9-17/i }));
    fireEvent.click(screen.getByRole("button", { name: /save allowed regions/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          startUtc: "2026-06-24T07:00:00.000Z",
          endUtc: "2026-06-24T15:00:00.000Z",
          timeZone: "Europe/Berlin",
        }),
      ]),
    );
  });

  it("disables editing controls for non-admin memberships", () => {
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          membership: { role: "member" },
          capabilities: { canAdminister: false, canReopen: false },
        }}
        onSave={vi.fn()}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    expect(screen.getByText(/read-only membership/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^allow$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save allowed regions/i })).toBeDisabled();
  });

  it("keeps finalized meetings read-only for admins", () => {
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          meeting: { ...editableData.meeting, lifecycleState: "finalized" },
        }}
        onSave={vi.fn()}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    expect(screen.getByText(/finalized meeting/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save allowed regions/i })).toBeDisabled();
  });

  it("warns when cleared regions cannot fit the meeting duration", () => {
    render(
      <AdminCalendarPainter
        data={editableData}
        onSave={vi.fn()}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));

    expect(
      screen.getByText(/paint at least one allowed region before saving/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save allowed regions/i })).toBeDisabled();
  });

  it("lets keyboard users paint a single duration-sized cell", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          meeting: {
            ...editableData.meeting,
            durationMinutes: 30,
            allowedTimeRanges: [],
          },
        }}
        onSave={onSave}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    fireEvent.keyDown(screen.getByRole("gridcell", { name: /wed jun 24 09:00/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /save allowed regions/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        startUtc: "2026-06-24T07:00:00.000Z",
        endUtc: "2026-06-24T07:30:00.000Z",
      }),
    ]);
  });

  it("lets touch users tap a cell without starting drag painting", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          meeting: {
            ...editableData.meeting,
            durationMinutes: 30,
            allowedTimeRanges: [],
          },
        }}
        onSave={onSave}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    const cell = screen.getByRole("gridcell", {
      name: /wed jun 24 09:00 blocked/i,
    });
    fireEvent.pointerDown(cell, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(cell, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("button", { name: /save allowed regions/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        startUtc: "2026-06-24T07:00:00.000Z",
        endUtc: "2026-06-24T07:30:00.000Z",
      }),
    ]);
  }, 10_000);

  it("does not paint when a touch gesture moves like a scroll", () => {
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          meeting: {
            ...editableData.meeting,
            durationMinutes: 30,
            allowedTimeRanges: [],
          },
        }}
        onSave={vi.fn()}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    const cell = screen.getByRole("gridcell", {
      name: /wed jun 24 09:00 blocked/i,
    });
    fireEvent.pointerDown(cell, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(cell, {
      pointerType: "touch",
      pointerId: 1,
      buttons: 1,
      clientX: 10,
      clientY: 40,
    });
    fireEvent.pointerUp(cell, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 10,
      clientY: 40,
    });

    expect(
      screen.getByRole("gridcell", { name: /wed jun 24 09:00 blocked/i }),
    ).toBeInTheDocument();
  });

  it("drag-paints across neighboring cells in the rendered grid", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminCalendarPainter
        data={{
          ...editableData,
          meeting: {
            ...editableData.meeting,
            allowedTimeRanges: [],
          },
        }}
        onSave={onSave}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    const startCell = screen.getByRole("gridcell", { name: /wed jun 24 09:00/i });
    const endCell = screen.getByRole("gridcell", { name: /wed jun 24 09:30/i });
    fireEvent.pointerDown(startCell);
    fireEvent.pointerEnter(endCell, { buttons: 1 });
    fireEvent.pointerUp(endCell);
    fireEvent.click(screen.getByRole("button", { name: /save allowed regions/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        startUtc: "2026-06-24T07:00:00.000Z",
        endUtc: "2026-06-24T08:00:00.000Z",
      }),
    ]);
  });

  it("clears stale save notices after later local edits", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AdminCalendarPainter
        data={editableData}
        onSave={onSave}
        baseDate={new Date("2026-06-24T12:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save allowed regions/i }));
    expect(await screen.findByText(/allowed regions saved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(screen.queryByText(/allowed regions saved/i)).not.toBeInTheDocument();
  });
});
