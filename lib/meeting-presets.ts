export type AllowedTimeRangeDraft = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
  label?: string;
};

export const allowedTimePresetIds = [
  "weekdays-9-17-next-2-weeks",
  "next-10-days-10-16",
  "custom-daily-range",
] as const;

export type AllowedTimePresetId = (typeof allowedTimePresetIds)[number];

export type CustomDailyRangeInput = {
  fromDate: string;
  toDate: string;
  startTime: string;
  endTime: string;
  includeWeekends: boolean;
};

export type BuildAllowedTimeRangesInput = {
  presetId: AllowedTimePresetId;
  timeZone: string;
  baseDate?: Date;
  customRange?: CustomDailyRangeInput;
};

export const MAX_CUSTOM_RANGE_DAYS = 42;

export function buildAllowedTimeRanges({
  presetId,
  timeZone,
  baseDate = new Date(),
  customRange,
}: BuildAllowedTimeRangesInput): AllowedTimeRangeDraft[] {
  assertIanaTimeZone(timeZone);
  const today = getDateKeyInTimeZone(baseDate, timeZone);

  if (presetId === "weekdays-9-17-next-2-weeks") {
    return buildDailyRanges({
      fromDate: addDaysToDateKey(today, 1),
      dayCount: 14,
      startTime: "09:00",
      endTime: "17:00",
      includeWeekends: false,
      timeZone,
      labelPrefix: "Weekday 9-17",
    });
  }

  if (presetId === "next-10-days-10-16") {
    return buildDailyRanges({
      fromDate: addDaysToDateKey(today, 1),
      dayCount: 10,
      startTime: "10:00",
      endTime: "16:00",
      includeWeekends: true,
      timeZone,
      labelPrefix: "10-16",
    });
  }

  if (!customRange) {
    throw new Error("Custom range details are required");
  }

  return buildCustomDailyRanges(customRange, timeZone);
}

export function buildCustomDailyRanges(
  customRange: CustomDailyRangeInput,
  timeZone: string,
): AllowedTimeRangeDraft[] {
  const fromDate = parseDateKey(customRange.fromDate, "fromDate");
  const toDate = parseDateKey(customRange.toDate, "toDate");
  const startTime = parseTimeKey(customRange.startTime, "startTime");
  const endTime = parseTimeKey(customRange.endTime, "endTime");

  if (dateKeyToUtcMs(toDate) < dateKeyToUtcMs(fromDate)) {
    throw new Error("Custom range end date must be on or after the start date");
  }
  if (timeKeyToMinutes(endTime) <= timeKeyToMinutes(startTime)) {
    throw new Error("Custom range end time must be after the start time");
  }

  const dayCount =
    Math.round((dateKeyToUtcMs(toDate) - dateKeyToUtcMs(fromDate)) / dayMs) + 1;
  if (dayCount > MAX_CUSTOM_RANGE_DAYS) {
    throw new Error(`Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`);
  }

  return buildDailyRanges({
    fromDate,
    dayCount,
    startTime,
    endTime,
    includeWeekends: customRange.includeWeekends,
    timeZone,
    labelPrefix: "Custom",
  });
}

function buildDailyRanges({
  fromDate,
  dayCount,
  startTime,
  endTime,
  includeWeekends,
  timeZone,
  labelPrefix,
}: {
  fromDate: string;
  dayCount: number;
  startTime: string;
  endTime: string;
  includeWeekends: boolean;
  timeZone: string;
  labelPrefix: string;
}) {
  const ranges: AllowedTimeRangeDraft[] = [];
  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    const date = addDaysToDateKey(fromDate, dayOffset);
    if (!includeWeekends && isWeekend(date)) {
      continue;
    }

    const startUtc = zonedWallTimeToUtc(date, startTime, timeZone);
    const endUtc = zonedWallTimeToUtc(date, endTime, timeZone);
    ranges.push({
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
      timeZone,
      label: `${labelPrefix} ${date}`,
    });
  }

  if (ranges.length === 0) {
    throw new Error("Allowed time preset produced no ranges");
  }
  return ranges;
}

export function zonedWallTimeToUtc(
  dateKey: string,
  timeKey: string,
  timeZone: string,
): Date {
  const date = parseDateKey(dateKey, "date");
  const time = parseTimeKey(timeKey, "time");
  const wallTimeMs = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
    0,
    0,
  );
  const firstGuess = wallTimeMs - getTimeZoneOffsetMs(new Date(wallTimeMs), timeZone);
  const secondGuess = wallTimeMs - getTimeZoneOffsetMs(new Date(firstGuess), timeZone);
  const result = new Date(secondGuess);
  const roundTrip = getZonedDateTimeKey(result, timeZone);
  if (roundTrip.dateKey !== date || roundTrip.timeKey !== time) {
    throw new Error(`Local time ${date} ${time} does not exist in ${timeZone}`);
  }
  return result;
}

function getZonedDateTimeKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${valueByType.get("year")}-${valueByType.get(
      "month",
    )}-${valueByType.get("day")}`,
    timeKey: `${valueByType.get("hour")}:${valueByType.get("minute")}`,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(valueByType.get("year")),
    Number(valueByType.get("month")) - 1,
    Number(valueByType.get("day")),
    Number(valueByType.get("hour")),
    Number(valueByType.get("minute")),
    Number(valueByType.get("second")),
  );
  return zonedAsUtc - date.getTime();
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get(
    "day",
  )}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey, "date");
  const next = new Date(dateKeyToUtcMs(date) + days * dayMs);
  return next.toISOString().slice(0, 10);
}

export function isWeekend(dateKey: string): boolean {
  const day = new Date(dateKeyToUtcMs(dateKey)).getUTCDay();
  return day === 0 || day === 6;
}

function dateKeyToUtcMs(dateKey: string): number {
  const date = parseDateKey(dateKey, "date");
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

export function timeKeyToMinutes(timeKey: string): number {
  const time = parseTimeKey(timeKey, "time");
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function parseDateKey(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD format`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return value;
}

function parseTimeKey(value: string, name: string): string {
  if (!/^\d{2}:\d{2}$/u.test(value)) {
    throw new Error(`${name} must use HH:mm format`);
  }
  const [hour, minute] = value.split(":").map(Number) as [number, number];
  if (hour > 23 || minute > 59) {
    throw new Error(`${name} must be a valid 24-hour time`);
  }
  return value;
}

function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

const dayMs = 24 * 60 * 60 * 1000;
