export const MAX_CALENDAR_DAYS = 42;
export const MAX_ALLOWED_TIME_RANGES = 512;
export const MAX_CALENDAR_CELLS = 4096;

/** Bound work before expanding ranges into cells, including on legacy reads. */
export function assertCalendarSize(
  ranges: { startUtc: string; endUtc: string }[],
  granularityMinutes: number,
) {
  if (!Number.isInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new Error("Calendar granularity must be a positive integer");
  }
  if (ranges.length > MAX_ALLOWED_TIME_RANGES) {
    throw new Error(
      `Calendar cannot contain more than ${MAX_ALLOWED_TIME_RANGES} ranges`,
    );
  }
  let earliest = Infinity;
  let latest = -Infinity;
  let cells = 0;
  for (const range of ranges) {
    const start = Date.parse(range.startUtc);
    const end = Date.parse(range.endUtc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Calendar ranges must contain valid increasing instants");
    }
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
    // Count overlapping input too: duplicate ranges still take work to expand.
    cells += Math.ceil((end - start) / (granularityMinutes * 60_000));
  }
  // Allow the extra hour when a 42-day local calendar crosses the fall DST change.
  if (latest - earliest > MAX_CALENDAR_DAYS * 86_400_000 + 3_600_000) {
    throw new Error(`Calendar cannot span more than ${MAX_CALENDAR_DAYS} days`);
  }
  if (cells > MAX_CALENDAR_CELLS) {
    throw new Error(`Calendar cannot contain more than ${MAX_CALENDAR_CELLS} cells`);
  }
}
