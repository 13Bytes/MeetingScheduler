import { describe, expect, it } from "vitest";
import {
  allowedCellKeysToRanges,
  buildCalendarGrid,
  createInitialPaintState,
  paintReducer,
  rangesToAllowedCellKeys,
  selectBusinessHours,
  selectWeekends,
  validatePaintedRanges,
} from "@/lib/admin-calendar-painter";

const berlinRanges = [
  {
    startUtc: "2026-06-25T07:00:00.000Z",
    endUtc: "2026-06-25T15:00:00.000Z",
    timeZone: "Europe/Berlin",
    label: "Thursday business hours",
  },
];

describe("admin calendar grid generation", () => {
  it("builds a stable timezone-aware grid from meeting settings", () => {
    const grid = buildCalendarGrid({
      timeZone: "Europe/Berlin",
      granularityMinutes: 30,
      durationMinutes: 60,
      allowedTimeRanges: berlinRanges,
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(grid.days).toHaveLength(14);
    expect(grid.timeKeys).toHaveLength(48);
    expect(grid.cellsByDateTime.get("2026-06-25_09:00")).toMatchObject({
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T07:30:00.000Z",
      timeLabel: "09:00",
    });
  });

  it("skips nonexistent local cells across daylight-saving transitions", () => {
    const grid = buildCalendarGrid({
      timeZone: "America/New_York",
      granularityMinutes: 30,
      durationMinutes: 60,
      allowedTimeRanges: [
        {
          startUtc: "2026-03-08T13:00:00.000Z",
          endUtc: "2026-03-08T17:00:00.000Z",
          timeZone: "America/New_York",
        },
      ],
      baseDate: new Date("2026-03-08T12:00:00.000Z"),
      minDays: 1,
      maxDays: 1,
    });

    expect(grid.cellsByDateTime.get("2026-03-08_01:00")).toBeDefined();
    expect(grid.cellsByDateTime.get("2026-03-08_01:30")).toBeUndefined();
    expect(grid.cellsByDateTime.get("2026-03-08_02:00")).toBeUndefined();
    expect(grid.cellsByDateTime.get("2026-03-08_02:30")).toBeUndefined();
    expect(grid.cellsByDateTime.get("2026-03-08_03:00")).toBeDefined();
  });

  it("skips fall-back cells whose real duration exceeds the granularity", () => {
    const grid = buildCalendarGrid({
      timeZone: "America/New_York",
      granularityMinutes: 30,
      durationMinutes: 60,
      allowedTimeRanges: [
        {
          startUtc: "2026-11-01T13:00:00.000Z",
          endUtc: "2026-11-01T17:00:00.000Z",
          timeZone: "America/New_York",
        },
      ],
      baseDate: new Date("2026-11-01T12:00:00.000Z"),
      minDays: 1,
      maxDays: 1,
    });

    expect(grid.cellsByDateTime.get("2026-11-01_01:00")).toBeDefined();
    expect(grid.cellsByDateTime.get("2026-11-01_01:30")).toBeUndefined();
    expect(grid.cellsByDateTime.get("2026-11-01_02:00")).toBeDefined();
  });

  it("preserves existing range dates beyond the minimum visible span by default", () => {
    const grid = buildCalendarGrid({
      timeZone: "UTC",
      granularityMinutes: 60,
      durationMinutes: 60,
      allowedTimeRanges: [
        {
          startUtc: "2026-07-24T09:00:00.000Z",
          endUtc: "2026-07-24T17:00:00.000Z",
          timeZone: "UTC",
        },
      ],
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(grid.days.at(-1)?.dateKey).toBe("2026-07-24");
    expect(grid.cellsByDateTime.get("2026-07-24_09:00")).toBeDefined();
  });
});

describe("admin paint reducer", () => {
  it("paints a rectangular allow preview and commits it", () => {
    const grid = buildCalendarGrid({
      timeZone: "UTC",
      granularityMinutes: 60,
      durationMinutes: 60,
      allowedTimeRanges: [],
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
      minDays: 2,
      maxDays: 2,
    });
    const anchor = grid.cellsByDateTime.get("2026-06-24_09:00");
    const target = grid.cellsByDateTime.get("2026-06-25_10:00");
    expect(anchor).toBeDefined();
    expect(target).toBeDefined();

    let state = createInitialPaintState();
    state = paintReducer(state, {
      type: "begin",
      cellKey: anchor!.key,
      mode: "allow",
    });
    state = paintReducer(state, {
      type: "hover",
      cellKey: target!.key,
      grid,
    });

    expect(state.previewCellKeys.size).toBe(4);

    state = paintReducer(state, { type: "commit" });
    expect(state.allowedCellKeys.size).toBe(4);
    expect(state.anchorCellKey).toBeNull();
  });

  it("blocks cells without disturbing adjacent allowed cells", () => {
    const grid = buildCalendarGrid({
      timeZone: "UTC",
      granularityMinutes: 60,
      durationMinutes: 60,
      allowedTimeRanges: [],
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
      minDays: 1,
      maxDays: 1,
    });
    const nine = grid.cellsByDateTime.get("2026-06-24_09:00")!;
    const ten = grid.cellsByDateTime.get("2026-06-24_10:00")!;
    let state = createInitialPaintState([nine.key, ten.key]);

    state = paintReducer(state, { type: "begin", cellKey: nine.key, mode: "block" });
    state = paintReducer(state, { type: "commit" });

    expect(state.allowedCellKeys.has(nine.key)).toBe(false);
    expect(state.allowedCellKeys.has(ten.key)).toBe(true);
  });
});

describe("range conversion and shortcuts", () => {
  it("round-trips persisted ranges through cells", () => {
    const grid = buildCalendarGrid({
      timeZone: "Europe/Berlin",
      granularityMinutes: 30,
      durationMinutes: 60,
      allowedTimeRanges: berlinRanges,
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
    });
    const allowed = rangesToAllowedCellKeys(grid, berlinRanges);
    const ranges = allowedCellKeysToRanges(grid, allowed);

    expect(allowed.size).toBe(16);
    expect(ranges).toEqual([
      {
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T15:00:00.000Z",
        timeZone: "Europe/Berlin",
        label: "Painted 2026-06-25",
      },
    ]);
  });

  it("validates that painted regions can contain the full duration", () => {
    const grid = buildCalendarGrid({
      timeZone: "UTC",
      granularityMinutes: 30,
      durationMinutes: 60,
      allowedTimeRanges: [],
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
      minDays: 1,
      maxDays: 1,
    });
    const shortCell = grid.cellsByDateTime.get("2026-06-24_09:00")!;
    const ranges = allowedCellKeysToRanges(grid, [shortCell.key]);

    expect(validatePaintedRanges(ranges, 60)).toMatchObject({ isValid: false });
    expect(validatePaintedRanges([], 60)).toMatchObject({ isValid: false });
  });

  it("selects business hours and weekend blocks for shortcut controls", () => {
    const grid = buildCalendarGrid({
      timeZone: "UTC",
      granularityMinutes: 60,
      durationMinutes: 60,
      allowedTimeRanges: [],
      baseDate: new Date("2026-06-26T12:00:00.000Z"),
      minDays: 3,
      maxDays: 3,
    });

    expect(selectBusinessHours(grid)).toHaveLength(8);
    expect(selectWeekends(grid)).toHaveLength(48);
  });
});
