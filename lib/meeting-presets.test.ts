import { describe, expect, it } from "vitest";
import { buildAllowedTimeRanges, buildCustomDailyRanges } from "@/lib/meeting-presets";

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
});
