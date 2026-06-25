import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_RANGE_DAYS,
  buildAllowedTimeRanges,
  buildCustomDailyRanges,
} from "@/lib/meeting-presets";

describe("allowed time presets", () => {
  it("builds weekday business ranges in the meeting timezone", () => {
    const ranges = buildAllowedTimeRanges({
      presetId: "weekdays-9-17-next-2-weeks",
      timeZone: "Europe/Berlin",
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(ranges).toHaveLength(10);
    expect(ranges[0]).toEqual({
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T15:00:00.000Z",
      timeZone: "Europe/Berlin",
      label: "Weekday 9-17 2026-06-25",
    });
    expect(ranges.every((range) => range.timeZone === "Europe/Berlin")).toBe(true);
  });

  it("builds ten broad daily ranges including weekends", () => {
    const ranges = buildAllowedTimeRanges({
      presetId: "next-10-days-10-16",
      timeZone: "UTC",
      baseDate: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(ranges).toHaveLength(10);
    expect(ranges[0]?.startUtc).toBe("2026-06-25T10:00:00.000Z");
    expect(ranges[9]?.endUtc).toBe("2026-07-04T16:00:00.000Z");
  });

  it("validates custom daily ranges", () => {
    expect(() =>
      buildAllowedTimeRanges({
        presetId: "custom-daily-range",
        timeZone: "UTC",
        baseDate: new Date("2026-06-24T12:00:00.000Z"),
      }),
    ).toThrow(/Custom range details are required/u);

    expect(
      buildCustomDailyRanges(
        {
          fromDate: "2026-06-26",
          toDate: "2026-06-29",
          startTime: "09:30",
          endTime: "11:00",
          includeWeekends: false,
        },
        "UTC",
      ),
    ).toEqual([
      {
        startUtc: "2026-06-26T09:30:00.000Z",
        endUtc: "2026-06-26T11:00:00.000Z",
        timeZone: "UTC",
        label: "Custom 2026-06-26",
      },
      {
        startUtc: "2026-06-29T09:30:00.000Z",
        endUtc: "2026-06-29T11:00:00.000Z",
        timeZone: "UTC",
        label: "Custom 2026-06-29",
      },
    ]);

    expect(() =>
      buildCustomDailyRanges(
        {
          fromDate: "2026-06-29",
          toDate: "2026-06-26",
          startTime: "09:00",
          endTime: "10:00",
          includeWeekends: true,
        },
        "UTC",
      ),
    ).toThrow(/end date/u);
  });

  it("rejects custom wall times that do not exist in the timezone", () => {
    expect(() =>
      buildCustomDailyRanges(
        {
          fromDate: "2026-03-08",
          toDate: "2026-03-08",
          startTime: "02:30",
          endTime: "03:30",
          includeWeekends: true,
        },
        "America/New_York",
      ),
    ).toThrow(/does not exist/u);
  });

  it("bounds custom ranges to keep later calendar grids manageable", () => {
    expect(
      buildCustomDailyRanges(
        {
          fromDate: "2026-06-01",
          toDate: "2026-07-12",
          startTime: "09:00",
          endTime: "17:00",
          includeWeekends: true,
        },
        "UTC",
      ),
    ).toHaveLength(MAX_CUSTOM_RANGE_DAYS);

    expect(() =>
      buildCustomDailyRanges(
        {
          fromDate: "2026-06-01",
          toDate: "2026-07-20",
          startTime: "09:00",
          endTime: "17:00",
          includeWeekends: true,
        },
        "UTC",
      ),
    ).toThrow(new RegExp(`cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`, "u"));
  });
});
