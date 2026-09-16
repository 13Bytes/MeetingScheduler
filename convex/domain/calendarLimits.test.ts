import { describe, expect, it } from "vitest";
import {
  assertCalendarSize,
  MAX_ALLOWED_TIME_RANGES,
  MAX_CALENDAR_CELLS,
} from "./calendarLimits";
import { normalizeMeetingSettings } from "./model";
import { generateCandidateSlots } from "./results";

const start = Date.parse("2026-09-01T00:00:00Z");
const range = (offset: number, minutes: number) => ({
  timeZone: "UTC",
  startUtc: new Date(start + offset * 60_000).toISOString(),
  endUtc: new Date(start + (offset + minutes) * 60_000).toISOString(),
});

describe("calendar work limits", () => {
  it("accepts the cell budget and rejects one additional cell", () => {
    expect(() => assertCalendarSize([range(0, MAX_CALENDAR_CELLS * 5)], 5)).not.toThrow();
    expect(() => assertCalendarSize([range(0, (MAX_CALENDAR_CELLS + 1) * 5)], 5)).toThrow(
      /cells/,
    );
  });
  it("bounds the whole span even when ranges are sparse", () => {
    expect(() => assertCalendarSize([range(0, 60), range(43 * 1440, 60)], 30)).toThrow(
      /42 days/,
    );
  });
  it("supports 42 local days across the autumn daylight saving transition", () => {
    expect(() => assertCalendarSize([range(0, 42 * 1440 + 60)], 30)).not.toThrow();
    expect(() => assertCalendarSize([range(0, 43 * 1440)], 30)).toThrow(/42 days/);
  });
  it("bounds range counts and overlapping expansion work", () => {
    expect(() =>
      assertCalendarSize(
        Array.from({ length: MAX_ALLOWED_TIME_RANGES + 1 }, () => range(0, 60)),
        30,
      ),
    ).toThrow(/ranges/);
    expect(() =>
      assertCalendarSize(
        Array.from({ length: 100 }, () => range(0, 1440)),
        30,
      ),
    ).toThrow(/cells/);
  });
  it("protects both writes and result generation from oversized legacy data", () => {
    const allowedTimeRanges = [range(0, 10 * 365 * 1440)];
    expect(() => normalizeMeetingSettings({ allowedTimeRanges })).toThrow(/42 days/);
    expect(() =>
      generateCandidateSlots({
        allowedTimeRanges,
        granularityMinutes: 30,
        durationMinutes: 60,
        timeZone: "UTC",
      }),
    ).toThrow(/42 days/);
  });
});
