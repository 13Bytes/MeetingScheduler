import type { AllowedTimeRangeDraft } from "@/lib/meeting-presets";
import {
  addDaysToDateKey,
  getDateKeyInTimeZone,
  isWeekend,
  MAX_CUSTOM_RANGE_DAYS,
  timeKeyToMinutes,
  zonedWallTimeToUtc,
} from "@/lib/meeting-presets";

export type PaintMode = "allow" | "block" | "preview";

export type CalendarGridInput = {
  timeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  allowedTimeRanges: AllowedTimeRangeDraft[];
  baseDate?: Date;
  minDays?: number;
  maxDays?: number;
  visibleFromDate?: string;
  visibleToDate?: string;
};

export type CalendarGridDay = {
  dateKey: string;
  label: string;
  weekdayLabel: string;
  isWeekend: boolean;
};

export type CalendarGridCell = {
  key: string;
  dateKey: string;
  timeKey: string;
  startUtc: string;
  endUtc: string;
  timeLabel: string;
  dayLabel: string;
  isWeekend: boolean;
};

export type CalendarGrid = {
  days: CalendarGridDay[];
  timeKeys: string[];
  cellsByKey: Map<string, CalendarGridCell>;
  cellsByDateTime: Map<string, CalendarGridCell>;
  orderedCells: CalendarGridCell[];
  timeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
};

export type PaintState = {
  allowedCellKeys: Set<string>;
  previewCellKeys: Set<string>;
  anchorCellKey: string | null;
  activeMode: PaintMode;
};

export type PaintAction =
  | { type: "begin"; cellKey: string; mode: PaintMode }
  | { type: "hover"; cellKey: string; grid: CalendarGrid }
  | { type: "commit" }
  | { type: "cancel" }
  | { type: "replace"; allowedCellKeys: Iterable<string> }
  | {
      type: "applyPreset";
      cellKeys: Iterable<string>;
      mode: Exclude<PaintMode, "preview">;
    };

export function buildCalendarGrid({
  timeZone,
  granularityMinutes,
  durationMinutes,
  allowedTimeRanges,
  baseDate = new Date(),
  minDays = 14,
  maxDays,
  visibleFromDate,
  visibleToDate,
}: CalendarGridInput): CalendarGrid {
  assertGridSettings(granularityMinutes, durationMinutes);
  const today = getDateKeyInTimeZone(baseDate, timeZone);
  const rangeDateKeys = allowedTimeRanges.flatMap((range) => [
    getDateKeyInTimeZone(new Date(range.startUtc), timeZone),
    getDateKeyInTimeZone(new Date(Date.parse(range.endUtc) - 1), timeZone),
  ]);
  if ((visibleFromDate === undefined) !== (visibleToDate === undefined)) {
    throw new Error("Calendar visibility requires both a from and to date");
  }
  const hasVisibleDateRange =
    visibleFromDate !== undefined && visibleToDate !== undefined;
  const firstDate = hasVisibleDateRange
    ? addDaysToDateKey(visibleFromDate, 0)
    : minDateKey([today, ...rangeDateKeys]);
  const lastRangeDate = hasVisibleDateRange
    ? addDaysToDateKey(visibleToDate, 0)
    : maxDateKey([today, ...rangeDateKeys]);
  const requestedDayCount = daysBetween(firstDate, lastRangeDate) + 1;
  if (requestedDayCount < 1) {
    throw new Error("Calendar to date must be on or after its from date");
  }
  if (hasVisibleDateRange && requestedDayCount > MAX_CUSTOM_RANGE_DAYS) {
    throw new Error(`Calendar range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`);
  }
  const dayCount = hasVisibleDateRange
    ? maxDays
      ? Math.min(requestedDayCount, maxDays)
      : requestedDayCount
    : maxDays
      ? Math.min(Math.max(requestedDayCount, minDays), maxDays)
      : Math.max(requestedDayCount, minDays);
  const days = Array.from({ length: dayCount }, (_, dayOffset) => {
    const dateKey = addDaysToDateKey(firstDate, dayOffset);
    const date = zonedWallTimeToUtc(dateKey, "12:00", timeZone);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).formatToParts(date);
    const valueByType = new Map(parts.map((part) => [part.type, part.value]));
    const weekdayLabel = valueByType.get("weekday") ?? dateKey;
    const label = `${weekdayLabel} ${valueByType.get("month")} ${valueByType.get("day")}`;
    return {
      dateKey,
      label,
      weekdayLabel,
      isWeekend: isWeekend(dateKey),
    };
  });

  const timeKeys = buildTimeKeys(granularityMinutes);
  const cellsByKey = new Map<string, CalendarGridCell>();
  const cellsByDateTime = new Map<string, CalendarGridCell>();
  const orderedCells: CalendarGridCell[] = [];

  for (const timeKey of timeKeys) {
    for (const day of days) {
      const cell = buildCell(day, timeKey, granularityMinutes, timeZone);
      if (!cell) {
        continue;
      }
      cellsByKey.set(cell.key, cell);
      cellsByDateTime.set(`${day.dateKey}_${timeKey}`, cell);
      orderedCells.push(cell);
    }
  }

  return {
    days,
    timeKeys,
    cellsByKey,
    cellsByDateTime,
    orderedCells,
    timeZone,
    granularityMinutes,
    durationMinutes,
  };
}

export function createInitialPaintState(
  allowedCellKeys: Iterable<string> = [],
): PaintState {
  return {
    allowedCellKeys: new Set(allowedCellKeys),
    previewCellKeys: new Set(),
    anchorCellKey: null,
    activeMode: "allow",
  };
}

export function paintReducer(state: PaintState, action: PaintAction): PaintState {
  if (action.type === "replace") {
    return createInitialPaintState(action.allowedCellKeys);
  }

  if (action.type === "applyPreset") {
    const allowedCellKeys = new Set(state.allowedCellKeys);
    for (const key of action.cellKeys) {
      if (action.mode === "allow") {
        allowedCellKeys.add(key);
      } else {
        allowedCellKeys.delete(key);
      }
    }
    return { ...state, allowedCellKeys, previewCellKeys: new Set(), anchorCellKey: null };
  }

  if (action.type === "begin") {
    return {
      ...state,
      activeMode: action.mode,
      anchorCellKey: action.cellKey,
      previewCellKeys: new Set([action.cellKey]),
    };
  }

  if (action.type === "hover") {
    if (!state.anchorCellKey) {
      return state;
    }
    return {
      ...state,
      previewCellKeys: getCellKeysInRectangle(
        action.grid,
        state.anchorCellKey,
        action.cellKey,
      ),
    };
  }

  if (action.type === "cancel") {
    return { ...state, previewCellKeys: new Set(), anchorCellKey: null };
  }

  const allowedCellKeys = new Set(state.allowedCellKeys);
  if (state.activeMode === "allow") {
    for (const key of state.previewCellKeys) {
      allowedCellKeys.add(key);
    }
  } else if (state.activeMode === "block") {
    for (const key of state.previewCellKeys) {
      allowedCellKeys.delete(key);
    }
  }
  return {
    ...state,
    allowedCellKeys,
    previewCellKeys: new Set(),
    anchorCellKey: null,
  };
}

export function rangesToAllowedCellKeys(
  grid: CalendarGrid,
  ranges: AllowedTimeRangeDraft[],
): Set<string> {
  const allowed = new Set<string>();
  const normalizedRanges = ranges.map((range) => ({
    startMs: Date.parse(range.startUtc),
    endMs: Date.parse(range.endUtc),
  }));

  for (const cell of grid.orderedCells) {
    const startMs = Date.parse(cell.startUtc);
    const endMs = Date.parse(cell.endUtc);
    if (
      normalizedRanges.some((range) => startMs >= range.startMs && endMs <= range.endMs)
    ) {
      allowed.add(cell.key);
    }
  }

  return allowed;
}

export function allowedCellKeysToRanges(
  grid: CalendarGrid,
  allowedCellKeys: Iterable<string>,
): AllowedTimeRangeDraft[] {
  const allowed = new Set(allowedCellKeys);
  const ranges: AllowedTimeRangeDraft[] = [];

  for (const day of grid.days) {
    let openRun: CalendarGridCell[] = [];
    for (const timeKey of grid.timeKeys) {
      const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
      if (cell && allowed.has(cell.key)) {
        openRun.push(cell);
        continue;
      }
      ranges.push(...cellsToRanges(openRun, grid.timeZone));
      openRun = [];
    }
    ranges.push(...cellsToRanges(openRun, grid.timeZone));
  }

  return ranges;
}

export function allowedCellKeysToRangesForSave(
  grid: CalendarGrid,
  allowedCellKeys: Iterable<string>,
  originalRanges: AllowedTimeRangeDraft[],
): AllowedTimeRangeDraft[] {
  const remainingCellKeys = new Set(allowedCellKeys);
  const preservedRanges: AllowedTimeRangeDraft[] = [];

  for (const originalRange of originalRanges) {
    const originalCellKeys = rangesToAllowedCellKeys(grid, [originalRange]);
    if (
      originalCellKeys.size > 0 &&
      Array.from(originalCellKeys).every((cellKey) => remainingCellKeys.has(cellKey))
    ) {
      preservedRanges.push(originalRange);
      for (const cellKey of originalCellKeys) {
        remainingCellKeys.delete(cellKey);
      }
    }
  }

  return [...preservedRanges, ...allowedCellKeysToRanges(grid, remainingCellKeys)].sort(
    (left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc),
  );
}

export function validatePaintedRanges(
  ranges: AllowedTimeRangeDraft[],
  durationMinutes: number,
) {
  if (ranges.length === 0) {
    return {
      isValid: false,
      message: "Paint at least one allowed region before saving.",
    };
  }

  const tooShort = ranges.find(
    (range) =>
      (Date.parse(range.endUtc) - Date.parse(range.startUtc)) / (60 * 1000) <
      durationMinutes,
  );
  if (tooShort) {
    return {
      isValid: false,
      message: "Every painted allowed region must fit the full meeting duration.",
    };
  }

  return { isValid: true, message: null };
}

export function selectBusinessHours(
  grid: CalendarGrid,
  startTime = "09:00",
  endTime = "17:00",
) {
  const startMinutes = timeKeyToMinutes(startTime);
  const endMinutes = timeKeyToMinutes(endTime);
  return grid.orderedCells
    .filter((cell) => {
      const minute = timeKeyToMinutes(cell.timeKey);
      return !cell.isWeekend && minute >= startMinutes && minute < endMinutes;
    })
    .map((cell) => cell.key);
}

export function selectWeekends(grid: CalendarGrid) {
  return grid.orderedCells.filter((cell) => cell.isWeekend).map((cell) => cell.key);
}

export function selectDayPart(grid: CalendarGrid, dayPart: "morning" | "afternoon") {
  const [startMinutes, endMinutes] =
    dayPart === "morning" ? [9 * 60, 12 * 60] : [13 * 60, 17 * 60];
  return grid.orderedCells
    .filter((cell) => {
      const minute = timeKeyToMinutes(cell.timeKey);
      return !cell.isWeekend && minute >= startMinutes && minute < endMinutes;
    })
    .map((cell) => cell.key);
}

function buildTimeKeys(granularityMinutes: number) {
  const timeKeys: string[] = [];
  for (let minute = 0; minute < 24 * 60; minute += granularityMinutes) {
    timeKeys.push(minutesToTimeKey(minute));
  }
  return timeKeys;
}

function buildCell(
  day: CalendarGridDay,
  timeKey: string,
  granularityMinutes: number,
  timeZone: string,
): CalendarGridCell | null {
  try {
    const startUtc = zonedWallTimeToUtc(day.dateKey, timeKey, timeZone);
    const endMinutes = timeKeyToMinutes(timeKey) + granularityMinutes;
    const endDateKey =
      endMinutes >= 24 * 60 ? addDaysToDateKey(day.dateKey, 1) : day.dateKey;
    const endTimeKey = minutesToTimeKey(endMinutes % (24 * 60));
    const endUtc = zonedWallTimeToUtc(endDateKey, endTimeKey, timeZone);
    if (endUtc.getTime() - startUtc.getTime() !== granularityMinutes * 60 * 1000) {
      return null;
    }
    return {
      key: `${startUtc.toISOString()}_${endUtc.toISOString()}`,
      dateKey: day.dateKey,
      timeKey,
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
      timeLabel: timeKey,
      dayLabel: day.label,
      isWeekend: day.isWeekend,
    };
  } catch {
    return null;
  }
}

function cellsToRanges(
  cells: CalendarGridCell[],
  timeZone: string,
): AllowedTimeRangeDraft[] {
  if (cells.length === 0) {
    return [];
  }
  return [
    {
      startUtc: cells[0].startUtc,
      endUtc: cells[cells.length - 1].endUtc,
      timeZone,
      label: `Painted ${cells[0].dateKey}`,
    },
  ];
}

function getCellKeysInRectangle(
  grid: CalendarGrid,
  anchorCellKey: string,
  targetCellKey: string,
) {
  const anchor = grid.cellsByKey.get(anchorCellKey);
  const target = grid.cellsByKey.get(targetCellKey);
  if (!anchor || !target) {
    return new Set<string>();
  }

  const dayIndexes = new Map(grid.days.map((day, index) => [day.dateKey, index]));
  const timeIndexes = new Map(grid.timeKeys.map((timeKey, index) => [timeKey, index]));
  const startDayIndex = Math.min(
    dayIndexes.get(anchor.dateKey) ?? 0,
    dayIndexes.get(target.dateKey) ?? 0,
  );
  const endDayIndex = Math.max(
    dayIndexes.get(anchor.dateKey) ?? 0,
    dayIndexes.get(target.dateKey) ?? 0,
  );
  const startTimeIndex = Math.min(
    timeIndexes.get(anchor.timeKey) ?? 0,
    timeIndexes.get(target.timeKey) ?? 0,
  );
  const endTimeIndex = Math.max(
    timeIndexes.get(anchor.timeKey) ?? 0,
    timeIndexes.get(target.timeKey) ?? 0,
  );
  const keys = new Set<string>();

  for (let timeIndex = startTimeIndex; timeIndex <= endTimeIndex; timeIndex += 1) {
    for (let dayIndex = startDayIndex; dayIndex <= endDayIndex; dayIndex += 1) {
      const cell = grid.cellsByDateTime.get(
        `${grid.days[dayIndex].dateKey}_${grid.timeKeys[timeIndex]}`,
      );
      if (cell) {
        keys.add(cell.key);
      }
    }
  }

  return keys;
}

function assertGridSettings(granularityMinutes: number, durationMinutes: number) {
  if (
    !Number.isInteger(granularityMinutes) ||
    granularityMinutes <= 0 ||
    (24 * 60 * 60) % (granularityMinutes * 60) !== 0
  ) {
    throw new Error("granularityMinutes must divide a 24-hour day");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer");
  }
  if (durationMinutes % granularityMinutes !== 0) {
    throw new Error("durationMinutes must be a multiple of granularityMinutes");
  }
}

function minutesToTimeKey(minutes: number) {
  const normalized = minutes % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function minDateKey(dateKeys: string[]) {
  return dateKeys.reduce((min, value) => (value < min ? value : min), dateKeys[0]);
}

function maxDateKey(dateKeys: string[]) {
  return dateKeys.reduce((max, value) => (value > max ? value : max), dateKeys[0]);
}

function daysBetween(startDateKey: string, endDateKey: string) {
  const start = Date.parse(`${startDateKey}T00:00:00.000Z`);
  const end = Date.parse(`${endDateKey}T00:00:00.000Z`);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}
