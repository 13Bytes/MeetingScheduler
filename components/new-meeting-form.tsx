"use client";

import {
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  Eraser,
  Loader2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import type { AllowedTimeRangeDraft, AllowedTimePresetId } from "@/lib/meeting-presets";
import { buildAllowedTimeRanges } from "@/lib/meeting-presets";
import {
  allowedCellKeysToRangesForSave,
  buildCalendarGrid,
  createInitialPaintState,
  paintReducer,
  rangesToAllowedCellKeys,
  validatePaintedRanges,
  type PaintMode,
} from "@/lib/admin-calendar-painter";
import { buildCreatedMeetingLinks } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { BrushControls, CalendarPaintGrid } from "@/components/calendar-paint-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AdminMode = "roleBased" | "everyoneAdmin";
type PrivacyMode = "detailed" | "summaryOnly";

type CreateMeetingArgs = {
  title: string;
  description?: string;
  creatorEmail?: string;
  clientRateLimitKey?: string;
  creatorPrivacyMode: PrivacyMode;
  adminMode: AdminMode;
  settings: {
    canonicalTimeZone: string;
    durationMinutes: number;
    granularityMinutes: number;
    allowedTimeRanges: AllowedTimeRangeDraft[];
  };
};

type CreateMeetingResult = {
  slug: string;
  adminMembershipToken: string;
};

export function NewMeetingForm({
  createMeeting,
  onCreatedRedirect,
  assignLocation = (url) => window.location.assign(url),
}: {
  createMeeting?: (args: CreateMeetingArgs) => Promise<CreateMeetingResult>;
  onCreatedRedirect?: (adminMembershipUrl: string) => void;
  assignLocation?: (adminMembershipUrl: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
  const [timeZone, setTimeZone] = useState(getDefaultTimeZone);
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [granularityMinutes, setGranularityMinutes] = useState("30");
  const [creatorPrivacyMode, setCreatorPrivacyMode] = useState<PrivacyMode>("detailed");
  const [everyoneAdmin, setEveryoneAdmin] = useState(false);
  const [presetId, setPresetId] = useState<AllowedTimePresetId>(
    "weekdays-9-17-next-2-weeks",
  );
  const [customFromDate, setCustomFromDate] = useState(getDefaultCustomFromDate);
  const [customToDate, setCustomToDate] = useState(getDefaultCustomToDate);
  const [customStartTime, setCustomStartTime] = useState("09:00");
  const [customEndTime, setCustomEndTime] = useState("17:00");
  const [customWeekdays, setCustomWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [useConstraintCalendar, setUseConstraintCalendar] = useState(false);
  const [paintMode, setPaintMode] = useState<PaintMode>("allow");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const timeZoneOptions = useMemo(() => buildTimeZoneOptions(timeZone), [timeZone]);
  const previewRanges = useMemo(() => {
    try {
      return buildSelectedRanges({
        presetId,
        timeZone,
        customFromDate,
        customToDate,
        customStartTime,
        customEndTime,
        customWeekdays,
      });
    } catch {
      return [];
    }
  }, [
    presetId,
    timeZone,
    customFromDate,
    customToDate,
    customStartTime,
    customEndTime,
    customWeekdays,
  ]);
  const duration = Number(durationMinutes);
  const granularity = Number(granularityMinutes);
  const calendarDuration =
    Number.isInteger(duration) &&
    Number.isInteger(granularity) &&
    duration > 0 &&
    granularity > 0 &&
    duration % granularity === 0
      ? duration
      : 30;
  const calendarGranularity =
    Number.isInteger(granularity) && granularity > 0 ? granularity : 30;
  const calendarDateRange = useMemo(
    () => getCustomCalendarDateRange(presetId, customFromDate, customToDate),
    [customFromDate, customToDate, presetId],
  );
  const calendarGrid = useMemo(
    () =>
      buildCalendarGrid({
        timeZone,
        granularityMinutes: calendarGranularity,
        durationMinutes: calendarDuration,
        allowedTimeRanges: previewRanges,
        ...(calendarDateRange ?? {}),
      }),
    [calendarDateRange, calendarDuration, calendarGranularity, previewRanges, timeZone],
  );
  const initialAllowedCellKeys = useMemo(
    () => rangesToAllowedCellKeys(calendarGrid, previewRanges),
    [calendarGrid, previewRanges],
  );
  const [paintState, dispatchPaint] = useReducer(
    paintReducer,
    initialAllowedCellKeys,
    createInitialPaintState,
  );
  const calendarSourceKey = useMemo(
    () =>
      JSON.stringify({
        timeZone,
        duration: calendarDuration,
        granularity: calendarGranularity,
        visibleDateRange: calendarDateRange,
        ranges: previewRanges,
      }),
    [calendarDateRange, calendarDuration, calendarGranularity, previewRanges, timeZone],
  );
  const [paintSourceKey, markPaintSourceKey] = useReducer(
    (_current: string, next: string) => next,
    calendarSourceKey,
  );
  const displayedPaintState =
    paintSourceKey === calendarSourceKey
      ? paintState
      : createInitialPaintState(initialAllowedCellKeys);
  useEffect(() => {
    dispatchPaint({ type: "replace", allowedCellKeys: initialAllowedCellKeys });
    markPaintSourceKey(calendarSourceKey);
  }, [calendarSourceKey, initialAllowedCellKeys]);
  const calendarRanges = useMemo(
    () =>
      allowedCellKeysToRangesForSave(
        calendarGrid,
        displayedPaintState.allowedCellKeys,
        previewRanges,
      ),
    [calendarGrid, displayedPaintState.allowedCellKeys, previewRanges],
  );
  const calendarValidation = useMemo(
    () => validatePaintedRanges(calendarRanges, calendarDuration),
    [calendarDuration, calendarRanges],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!createMeeting) {
      setError("Convex is not configured for this environment yet.");
      return;
    }

    if (!title.trim()) {
      setError("Add a meeting title before creating the poll.");
      return;
    }
    if (!Number.isInteger(duration) || !Number.isInteger(granularity)) {
      setError("Duration and granularity must be whole minutes.");
      return;
    }
    if (duration % granularity !== 0) {
      setError("Meeting duration must be a multiple of the time slot granularity.");
      return;
    }

    let allowedTimeRanges: AllowedTimeRangeDraft[];
    try {
      allowedTimeRanges = useConstraintCalendar
        ? calendarRanges
        : buildSelectedRanges({
            presetId,
            timeZone,
            customFromDate,
            customToDate,
            customStartTime,
            customEndTime,
            customWeekdays,
          });
      if (useConstraintCalendar && !calendarValidation.isValid) {
        throw new Error(
          calendarValidation.message ?? "Paint at least one valid allowed region.",
        );
      }
      validateAllowedTimeRanges(allowedTimeRanges, duration, granularity);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Allowed time range settings are invalid.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createMeeting({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(creatorEmail.trim() ? { creatorEmail: creatorEmail.trim() } : {}),
        creatorPrivacyMode,
        adminMode: everyoneAdmin ? "everyoneAdmin" : "roleBased",
        settings: {
          canonicalTimeZone: timeZone,
          durationMinutes: duration,
          granularityMinutes: granularity,
          allowedTimeRanges,
        },
      });
      const links = buildCreatedMeetingLinks({
        origin: window.location.origin,
        meetingSlug: result.slug,
        adminMembershipToken: result.adminMembershipToken,
      });
      if (onCreatedRedirect) {
        onCreatedRedirect(links.adminMembershipUrl);
      } else {
        assignLocation(links.adminMembershipUrl);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Meeting creation failed. Please try again.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <section className="space-y-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              Create a meeting
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Set broad candidate windows, create your anonymous admin membership, then
              share the public poll link.
            </p>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-5 text-primary" aria-hidden="true" />
              Meeting Details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium text-foreground">Title</span>
              <input
                className={inputClassName}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Q3 planning"
                required
              />
            </label>
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                Description <span className="font-normal text-slate-500">optional</span>
              </span>
              <textarea
                className={cn(inputClassName, "min-h-24 resize-y py-2")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add agenda, context, or location notes."
              />
            </label>
            <label className="grid gap-2 md:col-span-2">
              <span className="text-sm font-medium text-foreground">
                Recovery email{" "}
                <span className="font-normal text-slate-500">optional</span>
              </span>
              <input
                className={inputClassName}
                type="email"
                autoComplete="email"
                value={creatorEmail}
                onChange={(event) => setCreatorEmail(event.target.value)}
                placeholder="ada@example.com"
              />
              <span className="text-xs leading-5 text-slate-500">
                Used only to help recover your admin membership if you lose the link.
              </span>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Timezone</span>
              <select
                className={inputClassName}
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
              >
                {timeZoneOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Duration</span>
              <select
                className={inputClassName}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              >
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">2 hours</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Granularity</span>
              <select
                className={inputClassName}
                value={granularityMinutes}
                onChange={(event) => setGranularityMinutes(event.target.value)}
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Privacy mode</span>
              <select
                className={inputClassName}
                value={creatorPrivacyMode}
                onChange={(event) =>
                  setCreatorPrivacyMode(event.target.value as PrivacyMode)
                }
              >
                <option value="detailed">Detailed availability</option>
                <option value="summaryOnly">Summary only</option>
              </select>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              Access
            </CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-start gap-3 rounded-md border border-border bg-surface-muted p-4">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={everyoneAdmin}
                onChange={(event) => setEveryoneAdmin(event.target.checked)}
              />
              <span className="grid gap-1">
                <span className="text-sm font-medium text-foreground">
                  Everyone with a membership can administer this meeting
                </span>
                <span className="text-sm leading-6 text-slate-600">
                  Your creator link is still a personal admin membership link. This option
                  only changes how later member links are authorized.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="size-5 text-primary" aria-hidden="true" />
              Allowed Times
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="grid gap-3 md:grid-cols-3"
              role="radiogroup"
              aria-label="Allowed time preset"
            >
              {presetOptions.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    "grid cursor-pointer gap-2 rounded-md border p-4 text-sm transition-colors md:min-h-28",
                    presetId === option.id
                      ? "border-primary bg-blue-50"
                      : "border-border bg-surface hover:bg-surface-muted",
                  )}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="allowed-time-preset"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      value={option.id}
                      checked={presetId === option.id}
                      onChange={() => setPresetId(option.id)}
                    />
                    <span className="font-medium text-foreground">{option.label}</span>
                  </span>
                  <span className="leading-6 text-slate-600">{option.description}</span>
                </label>
              ))}
            </div>

            {presetId === "custom-daily-range" ? (
              <div className="grid gap-4 rounded-md border border-border bg-surface-muted p-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">From</span>
                  <input
                    className={inputClassName}
                    type="date"
                    value={customFromDate}
                    onChange={(event) => setCustomFromDate(event.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">To</span>
                  <input
                    className={inputClassName}
                    type="date"
                    value={customToDate}
                    onChange={(event) => setCustomToDate(event.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">Start</span>
                  <input
                    className={inputClassName}
                    type="time"
                    value={customStartTime}
                    onChange={(event) => setCustomStartTime(event.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">End</span>
                  <input
                    className={inputClassName}
                    type="time"
                    value={customEndTime}
                    onChange={(event) => setCustomEndTime(event.target.value)}
                  />
                </label>
                <fieldset className="grid gap-2 md:col-span-2">
                  <legend className="text-sm font-medium text-foreground">Days</legend>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {weekdayOptions.map((day) => (
                      <label
                        key={day.value}
                        className={cn(
                          "flex cursor-pointer items-center justify-center rounded-md border px-2 py-2 text-sm font-medium transition-colors",
                          customWeekdays.includes(day.value)
                            ? "border-primary bg-blue-50 text-blue-900"
                            : "border-border bg-surface text-slate-600 hover:bg-surface-muted",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={customWeekdays.includes(day.value)}
                          onChange={() =>
                            setCustomWeekdays((current) =>
                              current.includes(day.value)
                                ? current.filter((value) => value !== day.value)
                                : [...current, day.value],
                            )
                          }
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                  <span className="text-xs leading-5 text-slate-500">
                    Choose any combination of weekdays and weekends.
                  </span>
                </fieldset>
              </div>
            ) : null}

            <label className="flex items-start gap-3 rounded-md border border-border bg-surface p-4">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={useConstraintCalendar}
                onChange={(event) => setUseConstraintCalendar(event.target.checked)}
                aria-controls="creation-constraint-calendar"
              />
              <span className="grid gap-1">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CalendarDays className="size-4 text-primary" aria-hidden="true" />
                  Choose exact times in the Constraint Calendar
                </span>
                <span className="text-sm leading-6 text-slate-600">
                  Optional. Start with the preset above, then paint individual time slots.
                </span>
              </span>
            </label>

            {useConstraintCalendar ? (
              <div
                id="creation-constraint-calendar"
                className="overflow-hidden rounded-md border border-border bg-surface"
              >
                <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">Constraint Calendar</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Blue fields are allowed. Drag or use the keyboard to edit them.
                    </p>
                  </div>
                  <BrushControls
                    mode={paintMode}
                    disabled={false}
                    onModeChange={setPaintMode}
                  />
                </div>
                <CalendarPaintGrid
                  grid={calendarGrid}
                  mode={paintMode}
                  disabled={false}
                  allowedCellKeys={displayedPaintState.allowedCellKeys}
                  previewCellKeys={displayedPaintState.previewCellKeys}
                  ariaLabel="Creation allowed time calendar"
                  onBegin={(cellKey) =>
                    dispatchPaint({ type: "begin", cellKey, mode: paintMode })
                  }
                  onHover={(cellKey) =>
                    dispatchPaint({ type: "hover", cellKey, grid: calendarGrid })
                  }
                  onCommit={() => dispatchPaint({ type: "commit" })}
                  onCancel={() => dispatchPaint({ type: "cancel" })}
                  onApplyCell={(cellKey) => {
                    if (paintMode === "preview") {
                      dispatchPaint({ type: "begin", cellKey, mode: paintMode });
                      return;
                    }
                    dispatchPaint({
                      type: "applyPreset",
                      cellKeys: [cellKey],
                      mode: paintMode,
                    });
                  }}
                />
                <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    className={cn(
                      "text-sm",
                      calendarValidation.isValid ? "text-slate-600" : "text-warning",
                    )}
                  >
                    {calendarValidation.isValid
                      ? `${calendarRanges.length} exact allowed range${
                          calendarRanges.length === 1 ? "" : "s"
                        } will be used.`
                      : calendarValidation.message}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      dispatchPaint({ type: "replace", allowedCellKeys: [] })
                    }
                  >
                    <Eraser className="size-4" aria-hidden="true" />
                    Clear all
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {error ? (
          <div
            className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={isSubmitting || !createMeeting}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4" aria-hidden="true" />
            )}
            Create meeting
          </Button>
          {!createMeeting ? (
            <span className="text-sm text-slate-600">
              Set `NEXT_PUBLIC_CONVEX_URL` to enable live creation.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function buildSelectedRanges({
  presetId,
  timeZone,
  customFromDate,
  customToDate,
  customStartTime,
  customEndTime,
  customWeekdays,
}: {
  presetId: AllowedTimePresetId;
  timeZone: string;
  customFromDate: string;
  customToDate: string;
  customStartTime: string;
  customEndTime: string;
  customWeekdays: number[];
}) {
  return buildAllowedTimeRanges({
    presetId,
    timeZone,
    customRange:
      presetId === "custom-daily-range"
        ? {
            fromDate: customFromDate,
            toDate: customToDate,
            startTime: customStartTime,
            endTime: customEndTime,
            weekdays: customWeekdays,
          }
        : undefined,
  });
}

function getDefaultTimeZone() {
  return normalizeTimeZoneId(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}

function getCustomCalendarDateRange(
  presetId: AllowedTimePresetId,
  fromDate: string,
  toDate: string,
) {
  if (presetId !== "custom-daily-range") {
    return null;
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
  if (!datePattern.test(fromDate) || !datePattern.test(toDate)) {
    return null;
  }
  const fromTimestamp = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toTimestamp = Date.parse(`${toDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(fromTimestamp) ||
    !Number.isFinite(toTimestamp) ||
    new Date(fromTimestamp).toISOString().slice(0, 10) !== fromDate ||
    new Date(toTimestamp).toISOString().slice(0, 10) !== toDate ||
    toTimestamp < fromTimestamp
  ) {
    return null;
  }
  return { visibleFromDate: fromDate, visibleToDate: toDate };
}

function getDefaultCustomFromDate() {
  return shiftDateKey(new Date(), 1);
}

function getDefaultCustomToDate() {
  return shiftDateKey(new Date(), 14);
}

function shiftDateKey(date: Date, dayOffset: number) {
  const shifted = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
  );
  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-");
}

function validateAllowedTimeRanges(
  ranges: AllowedTimeRangeDraft[],
  durationMinutes: number,
  granularityMinutes: number,
) {
  for (const range of ranges) {
    const rangeMinutes =
      (Date.parse(range.endUtc) - Date.parse(range.startUtc)) / (60 * 1000);
    if (rangeMinutes < durationMinutes) {
      throw new Error("Each allowed range must be at least as long as the meeting.");
    }

    if (
      rangeMinutes % granularityMinutes !== 0 ||
      !isOnLocalGridBoundary(range.startUtc, range.timeZone, granularityMinutes) ||
      !isOnLocalGridBoundary(range.endUtc, range.timeZone, granularityMinutes)
    ) {
      throw new Error("Allowed range boundaries must align to the time slot grid.");
    }
  }
}

function isOnLocalGridBoundary(
  isoInstant: string,
  timeZone: string,
  granularityMinutes: number,
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(isoInstant));
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const minuteOfDay =
    Number(valueByType.get("hour")) * 60 + Number(valueByType.get("minute"));
  return (
    Number(valueByType.get("second")) === 0 && minuteOfDay % granularityMinutes === 0
  );
}

function buildTimeZoneOptions(currentTimeZone: string) {
  const supportedValuesOf = Intl.supportedValuesOf?.bind(Intl);
  const values = supportedValuesOf?.("timeZone") ?? [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  return Array.from(
    new Set([currentTimeZone, "UTC", ...values].map(normalizeTimeZoneId)),
  ).sort();
}

function normalizeTimeZoneId(timeZone: string) {
  return timeZoneAliases[timeZone] ?? timeZone;
}

const timeZoneAliases: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Godthab": "America/Nuuk",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Truk": "Pacific/Chuuk",
};

const weekdayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

const presetOptions: {
  id: AllowedTimePresetId;
  label: string;
  description: string;
}[] = [
  {
    id: "weekdays-9-17-next-2-weeks",
    label: "Weekdays 9-17",
    description: "Business hours over the next two weeks.",
  },
  {
    id: "next-10-days-10-16",
    label: "Next 10 days",
    description: "Daily 10-16 windows, including weekends.",
  },
  {
    id: "custom-daily-range",
    label: "Custom range",
    description: "Pick dates, days of the week, and daily hours.",
  },
];

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
