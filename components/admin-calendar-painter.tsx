"use client";

import {
  AlertTriangle,
  CalendarDays,
  Eraser,
  Loader2,
  RotateCcw,
  Save,
  SunMedium,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import type React from "react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { AllowedTimeRangeDraft } from "@/lib/meeting-presets";
import {
  allowedCellKeysToRangesForSave,
  buildCalendarGrid,
  createInitialPaintState,
  paintReducer,
  rangesToAllowedCellKeys,
  selectBusinessHours,
  selectDayPart,
  selectWeekends,
  validatePaintedRanges,
  type PaintMode,
} from "@/lib/admin-calendar-painter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BrushControls, CalendarPaintGrid } from "@/components/calendar-paint-grid";

type MeetingSummary = {
  _id?: string;
  title: string;
  description?: string;
  lifecycleState: "open" | "finalized";
  adminMode: "roleBased" | "everyoneAdmin";
  canonicalTimeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  allowedTimeRanges: AllowedTimeRangeDraft[];
  updatedAt?: number;
};

type MembershipSummary = {
  role: "admin" | "member";
  displayName?: string;
};

type MembershipCapabilities = {
  canAdminister: boolean;
  canReopen: boolean;
};

type AdminPainterData = {
  meeting: MeetingSummary;
  membership: MembershipSummary;
  capabilities: MembershipCapabilities;
};

export function ConnectedAdminCalendarPainter({
  membershipToken,
}: {
  membershipToken: string;
}) {
  const meetingData = useQuery(api.meetings.readMeetingByMembershipToken, {
    membershipToken,
  });
  const updateMeetingSettings = useMutation(api.meetings.updateMeetingSettings);

  if (meetingData === undefined) {
    return (
      <AdminPainterShell>
        <Card>
          <CardContent className="flex min-h-64 items-center justify-center gap-3 pt-5 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading your meeting
          </CardContent>
        </Card>
      </AdminPainterShell>
    );
  }

  if (meetingData === null) {
    return (
      <AdminPainterShell>
        <PermissionPanel
          title="Meeting link unavailable"
          description="This private link is invalid or no longer active."
        />
      </AdminPainterShell>
    );
  }

  return (
    <AdminCalendarPainter
      data={meetingData}
      onSave={(allowedTimeRanges) =>
        updateMeetingSettings({
          membershipToken,
          settings: {
            canonicalTimeZone: meetingData.meeting.canonicalTimeZone,
            granularityMinutes: meetingData.meeting.granularityMinutes,
            durationMinutes: meetingData.meeting.durationMinutes,
            allowedTimeRanges,
          },
        })
      }
    />
  );
}

export function AdminCalendarPainter({
  data,
  onSave,
  baseDate,
}: {
  data: AdminPainterData;
  onSave: (allowedTimeRanges: AllowedTimeRangeDraft[]) => Promise<unknown>;
  baseDate?: Date;
}) {
  const { meeting, capabilities } = data;
  const canEdit = capabilities.canAdminister && meeting.lifecycleState === "open";
  const [mode, setMode] = useState<PaintMode>("allow");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const grid = useMemo(
    () =>
      buildCalendarGrid({
        timeZone: meeting.canonicalTimeZone,
        granularityMinutes: meeting.granularityMinutes,
        durationMinutes: meeting.durationMinutes,
        allowedTimeRanges: meeting.allowedTimeRanges,
        baseDate,
      }),
    [
      meeting.allowedTimeRanges,
      meeting.canonicalTimeZone,
      meeting.durationMinutes,
      meeting.granularityMinutes,
      baseDate,
    ],
  );
  const initialAllowed = useMemo(
    () => rangesToAllowedCellKeys(grid, meeting.allowedTimeRanges),
    [grid, meeting.allowedTimeRanges],
  );
  const [paintState, dispatch] = useReducer(
    paintReducer,
    initialAllowed,
    createInitialPaintState,
  );
  const ranges = useMemo(
    () =>
      allowedCellKeysToRangesForSave(
        grid,
        paintState.allowedCellKeys,
        meeting.allowedTimeRanges,
      ),
    [grid, meeting.allowedTimeRanges, paintState.allowedCellKeys],
  );
  const validation = useMemo(
    () => validatePaintedRanges(ranges, meeting.durationMinutes),
    [meeting.durationMinutes, ranges],
  );

  useEffect(() => {
    dispatch({ type: "replace", allowedCellKeys: initialAllowed });
  }, [initialAllowed]);

  async function handleSave() {
    setError(null);
    setNotice(null);
    if (!canEdit) {
      setError("You do not have permission to edit this meeting.");
      return;
    }
    if (!validation.isValid) {
      setError(validation.message);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(ranges);
      setNotice("Allowed regions saved.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Saving allowed regions failed.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function applyShortcut(
    cellKeys: Iterable<string>,
    shortcutMode: Exclude<PaintMode, "preview">,
  ) {
    if (!canEdit) {
      return;
    }
    dispatch({ type: "applyPreset", cellKeys, mode: shortcutMode });
    setError(null);
    setNotice(null);
  }

  const paintedCellCount = paintState.allowedCellKeys.size;

  return (
    <AdminPainterShell>
      <section className="grid gap-3">
        <Badge variant="accent">Organizer</Badge>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
            {meeting.title}
          </h1>
          <p className="max-w-4xl text-sm leading-6 text-slate-600">
            Choose the times participants can respond to. Times are shown in{" "}
            {meeting.canonicalTimeZone}, and the meeting will last{" "}
            {meeting.durationMinutes} minutes.
          </p>
        </div>
      </section>

      {!capabilities.canAdminister ? (
        <PermissionPanel
          title="View only"
          description="You can view these times, but only an organizer can change them."
        />
      ) : null}

      {capabilities.canAdminister && meeting.lifecycleState === "finalized" ? (
        <PermissionPanel
          title="Finalized meeting"
          description="This meeting is closed. An organizer can reopen it if plans change."
        />
      ) : null}
      <p className="sr-only" aria-live="polite">
        {`${paintedCellCount} times selected.`}
      </p>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-5 text-primary" aria-hidden="true" />
                Available times
              </CardTitle>
              <BrushControls mode={mode} disabled={!canEdit} onModeChange={setMode} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <CalendarPaintGrid
              grid={grid}
              mode={mode}
              disabled={!canEdit}
              ariaLabel="Organizer availability calendar"
              allowedCellKeys={paintState.allowedCellKeys}
              previewCellKeys={paintState.previewCellKeys}
              onBegin={(cellKey) => {
                dispatch({ type: "begin", cellKey, mode });
                setError(null);
                setNotice(null);
              }}
              onHover={(cellKey) => dispatch({ type: "hover", cellKey, grid })}
              onCommit={() => dispatch({ type: "commit" })}
              onCancel={() => dispatch({ type: "cancel" })}
              onApplyCell={(cellKey) => {
                setError(null);
                setNotice(null);
                if (mode === "preview") {
                  dispatch({ type: "begin", cellKey, mode });
                  return;
                }
                dispatch({ type: "applyPreset", cellKeys: [cellKey], mode });
              }}
            />
          </CardContent>
        </Card>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Shortcuts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => applyShortcut(selectBusinessHours(grid), "allow")}
              >
                <SunMedium className="size-4" aria-hidden="true" />
                Fill weekdays 9-17
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => applyShortcut(selectWeekends(grid), "block")}
              >
                <Eraser className="size-4" aria-hidden="true" />
                Clear weekends
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => applyShortcut(selectDayPart(grid, "morning"), "block")}
              >
                <Eraser className="size-4" aria-hidden="true" />
                Clear weekday mornings
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => applyShortcut(selectDayPart(grid, "afternoon"), "block")}
              >
                <Eraser className="size-4" aria-hidden="true" />
                Clear weekday afternoons
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!canEdit}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  dispatch({ type: "replace", allowedCellKeys: [] });
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Clear all
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Save</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Selected times</dt>
                  <dd className="font-semibold text-foreground">{paintedCellCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Time windows</dt>
                  <dd className="font-semibold text-foreground">{ranges.length}</dd>
                </div>
              </dl>
              {!validation.isValid ? (
                <p className="text-sm leading-6 text-warning">{validation.message}</p>
              ) : (
                <p className="text-sm leading-6 text-slate-600">
                  Your selection has enough room for the full meeting.
                </p>
              )}
              {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
              {notice ? <StatusMessage tone="success">{notice}</StatusMessage> : null}
              <Button
                type="button"
                className="w-full"
                disabled={!canEdit || isSaving || !validation.isValid}
                onClick={handleSave}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Save allowed regions
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </AdminPainterShell>
  );
}

function PermissionPanel({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      role="status"
    >
      <AlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
      <span className="grid gap-1">
        <span className="font-medium">{title}</span>
        <span>{description}</span>
      </span>
    </div>
  );
}

function StatusMessage({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        tone === "error"
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-teal-200 bg-teal-50 text-teal-950",
      )}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}

function AdminPainterShell({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}
