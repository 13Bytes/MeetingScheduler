import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarPaintGrid } from "@/components/calendar-paint-grid";
import { buildCalendarGrid, type PaintMode } from "@/lib/admin-calendar-painter";

const grid = buildCalendarGrid({
  timeZone: "UTC",
  granularityMinutes: 30,
  durationMinutes: 30,
  allowedTimeRanges: [],
  visibleFromDate: "2026-06-22",
  visibleToDate: "2026-06-24",
});

function renderGrid({
  mode = "allow",
  onApplyCell = vi.fn(),
  onApplyRange,
}: {
  mode?: PaintMode;
  onApplyCell?: (cellKey: string) => void;
  onApplyRange?: (cellKeys: string[]) => void;
}) {
  return render(
    <CalendarPaintGrid
      grid={grid}
      mode={mode}
      disabled={false}
      allowedCellKeys={new Set()}
      previewCellKeys={new Set()}
      onBegin={vi.fn()}
      onHover={vi.fn()}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      onApplyCell={onApplyCell}
      onApplyRange={onApplyRange}
    />,
  );
}

function cellKeyFor(dateKey: string, timeKey: string) {
  return grid.cellsByDateTime.get(`${dateKey}_${timeKey}`)!.key;
}

function cellElement(dateKey: string, timeKey: string) {
  return document.querySelector<HTMLElement>(
    `[data-calendar-cell-key="${cellKeyFor(dateKey, timeKey)}"]`,
  )!;
}

describe("CalendarPaintGrid range selection", () => {
  it("paints the rectangle between two selected cells", () => {
    const onApplyCell = vi.fn();
    const onApplyRange = vi.fn();
    renderGrid({ onApplyCell, onApplyRange });

    fireEvent.click(screen.getByRole("button", { name: "Mark a range" }));
    expect(screen.getByText("Tap the first cell in the range.")).toBeInTheDocument();

    const startCell = cellElement("2026-06-22", "09:00");
    const endCell = cellElement("2026-06-23", "10:00");
    fireEvent.keyDown(startCell, { key: "Enter" });
    expect(
      screen.getByText("Range start selected. Scroll, then tap the end cell."),
    ).toBeInTheDocument();
    fireEvent.keyDown(endCell, { key: "Enter" });

    expect(onApplyCell).not.toHaveBeenCalled();
    expect(onApplyRange).toHaveBeenCalledTimes(1);
    const expectedKeys = ["2026-06-22", "2026-06-23"].flatMap((dateKey) =>
      ["09:00", "09:30", "10:00"].map((timeKey) => cellKeyFor(dateKey, timeKey)),
    );
    expect(new Set(onApplyRange.mock.calls[0][0])).toEqual(new Set(expectedKeys));
    // Range mode ends after the second cell.
    expect(screen.getByRole("button", { name: "Mark a range" })).toBeInTheDocument();
  });

  it("can cancel a range and falls back to single-cell edits", () => {
    const onApplyCell = vi.fn();
    const onApplyRange = vi.fn();
    renderGrid({ onApplyCell, onApplyRange });

    fireEvent.click(screen.getByRole("button", { name: "Mark a range" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const target = screen.getAllByRole("gridcell")[0];
    fireEvent.keyDown(target, { key: "Enter" });

    expect(onApplyRange).not.toHaveBeenCalled();
    expect(onApplyCell).toHaveBeenCalledWith(
      target.getAttribute("data-calendar-cell-key"),
    );
  });

  it("disables range marking for the preview brush", () => {
    renderGrid({ mode: "preview", onApplyRange: vi.fn() });
    expect(screen.getByRole("button", { name: "Mark a range" })).toBeDisabled();
  });

  it("hides the range bar when the caller does not opt in", () => {
    renderGrid({});
    expect(
      screen.queryByRole("button", { name: "Mark a range" }),
    ).not.toBeInTheDocument();
  });
});
