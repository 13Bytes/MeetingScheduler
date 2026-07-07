"use client";

import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { AllowedTimeRangeDraft, AllowedTimePresetId } from "@/lib/meeting-presets";
import { buildAllowedTimeRanges } from "@/lib/meeting-presets";
import { buildCreatedMeetingLinks } from "@/lib/routes";
import { cn } from "@/lib/utils";
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
}: {
  createMeeting?: (args: CreateMeetingArgs) => Promise<CreateMeetingResult>;
  onCreatedRedirect?: (adminMembershipUrl: string) => void;
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
  const [customIncludeWeekends, setCustomIncludeWeekends] = useState(false);
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
        customIncludeWeekends,
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
    customIncludeWeekends,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!createMeeting) {
      setError("Convex is not configured for this environment yet.");
      return;
    }

    const duration = Number(durationMinutes);
    const granularity = Number(granularityMinutes);
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
      allowedTimeRanges = buildSelectedRanges({
        presetId,
        timeZone,
        customFromDate,
        customToDate,
        customStartTime,
        customEndTime,
        customIncludeWeekends,
      });
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
        window.location.assign(links.adminMembershipUrl);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Meeting creation failed. Please try again.",
      );
    } finally {
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
                <label className="flex items-center gap-3 md:col-span-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={customIncludeWeekends}
                    onChange={(event) => setCustomIncludeWeekends(event.target.checked)}
                  />
                  <span className="text-sm font-medium text-foreground">
                    Include weekends
                  </span>
                </label>
              </div>
            ) : null}

            <div className="rounded-md border border-border bg-surface-muted p-4 text-sm text-slate-600">
              {previewRanges.length > 0
                ? `${previewRanges.length} broad allowed range${
                    previewRanges.length === 1 ? "" : "s"
                  } will be stored in ${timeZone}.`
                : "Adjust the allowed-time settings to preview generated ranges."}
            </div>
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

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>After Creation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-slate-600">
              You will be redirected to your private admin membership link. The meeting
              page will show invitation links and your private return link.
            </p>
          </CardContent>
        </Card>
      </aside>
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
  customIncludeWeekends,
}: {
  presetId: AllowedTimePresetId;
  timeZone: string;
  customFromDate: string;
  customToDate: string;
  customStartTime: string;
  customEndTime: string;
  customIncludeWeekends: boolean;
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
            includeWeekends: customIncludeWeekends,
          }
        : undefined,
  });
}

function getDefaultTimeZone() {
  return normalizeTimeZoneId(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
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
    description: "Pick dates, daily start and end times.",
  },
];

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
