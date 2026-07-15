"use client";

import {
  AlertTriangle,
  CalendarDays,
  Eraser,
  Loader2,
  MousePointer2,
  Paintbrush,
  RotateCcw,
  Save,
  SunMedium,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import type React from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  type CalendarGrid,
  type CalendarGridCell,
  type PaintMode,
} from "@/lib/admin-calendar-painter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function CalendarPaintGrid({
  grid,
  mode,
  disabled,
  allowedCellKeys,
  previewCellKeys,
  onBegin,
  onHover,
  onCommit,
  onCancel,
  onApplyCell,
}: {
  grid: CalendarGrid;
  mode: PaintMode;
  disabled: boolean;
  allowedCellKeys: Set<string>;
  previewCellKeys: Set<string>;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  const columnTemplate = `76px repeat(${grid.days.length}, minmax(64px, 1fr))`;
  return (
    <div
      className="max-h-[72vh] w-full min-w-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain"
      onPointerLeave={() => {
        if (!disabled) {
          onCancel();
        }
      }}
    >
      <div
        className="grid min-w-[720px] sm:min-w-[860px]"
        style={{ gridTemplateColumns: columnTemplate }}
        role="grid"
        aria-label="Organizer availability calendar"
      >
        <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-surface-muted px-3 py-2 text-xs font-medium text-slate-600">
          Time
        </div>
        {grid.days.map((day) => (
          <div
            key={day.dateKey}
            className={cn(
              "sticky top-0 z-10 border-b border-r border-border bg-surface-muted px-2 py-2 text-center text-xs font-medium text-slate-700",
              day.isWeekend && "bg-slate-100 text-slate-500",
            )}
          >
            <span className="block">{day.weekdayLabel}</span>
            <span className="block font-normal">{day.dateKey.slice(5)}</span>
          </div>
        ))}
        {grid.timeKeys.map((timeKey) => (
          <CalendarRow
            key={timeKey}
            grid={grid}
            timeKey={timeKey}
            mode={mode}
            disabled={disabled}
            allowedCellKeys={allowedCellKeys}
            previewCellKeys={previewCellKeys}
            onBegin={onBegin}
            onHover={onHover}
            onCommit={onCommit}
            onApplyCell={onApplyCell}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarRow({
  grid,
  timeKey,
  mode,
  disabled,
  allowedCellKeys,
  previewCellKeys,
  onBegin,
  onHover,
  onCommit,
  onApplyCell,
}: {
  grid: CalendarGrid;
  timeKey: string;
  mode: PaintMode;
  disabled: boolean;
  allowedCellKeys: Set<string>;
  previewCellKeys: Set<string>;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 min-h-9 border-b border-r border-border bg-surface-muted px-3 py-2 text-xs font-medium text-slate-500 sm:min-h-7 sm:py-1">
        {timeKey}
      </div>
      {grid.days.map((day) => {
        const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
        if (!cell) {
          return (
            <div
              key={`${day.dateKey}_${timeKey}`}
              className="min-h-9 border-b border-r border-border bg-slate-100 sm:min-h-7"
              aria-hidden="true"
            />
          );
        }
        return (
          <CalendarCellButton
            key={cell.key}
            cell={cell}
            mode={mode}
            disabled={disabled}
            isAllowed={allowedCellKeys.has(cell.key)}
            isPreview={previewCellKeys.has(cell.key)}
            onBegin={onBegin}
            onHover={onHover}
            onCommit={onCommit}
            onApplyCell={onApplyCell}
          />
        );
      })}
    </>
  );
}

function CalendarCellButton({
  cell,
  mode,
  disabled,
  isAllowed,
  isPreview,
  onBegin,
  onHover,
  onCommit,
  onApplyCell,
}: {
  cell: CalendarGridCell;
  mode: PaintMode;
  disabled: boolean;
  isAllowed: boolean;
  isPreview: boolean;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  const previewClass =
    mode === "block" ? "bg-rose-200" : mode === "preview" ? "bg-sky-200" : "bg-teal-200";
  const touchStartRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  return (
    <button
      type="button"
      role="gridcell"
      data-calendar-cell-key={cell.key}
      disabled={disabled}
      aria-selected={isAllowed}
      aria-label={`${cell.dayLabel} ${cell.timeLabel} ${
        isAllowed ? "allowed" : "blocked"
      }`}
      title={`${cell.dayLabel} ${cell.timeLabel}`}
      className={cn(
        "min-h-9 touch-manipulation select-none border-b border-r border-border outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed sm:min-h-7",
        isAllowed ? "bg-teal-500 hover:bg-teal-600" : "bg-surface hover:bg-blue-50",
        cell.isWeekend && !isAllowed && "bg-slate-50",
        isPreview && previewClass,
      )}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }
        if (event.pointerType === "touch") {
          touchStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onBegin(cell.key);
      }}
      onPointerMove={(event) => {
        if (disabled || event.buttons !== 1) {
          return;
        }
        const touchStart = touchStartRef.current;
        if (event.pointerType === "touch" && touchStart) {
          const deltaX = Math.abs(event.clientX - touchStart.x);
          const deltaY = Math.abs(event.clientY - touchStart.y);
          touchStart.moved = touchStart.moved || deltaX > 10 || deltaY > 10;
          return;
        }
        const targetCellKey = getPointerTargetCellKey(event);
        if (targetCellKey && targetCellKey !== cell.key) {
          onHover(targetCellKey);
        }
      }}
      onPointerEnter={(event) => {
        if (!disabled && event.buttons === 1) {
          onHover(cell.key);
        }
      }}
      onPointerUp={() => {
        if (disabled) {
          return;
        }
        const touchStart = touchStartRef.current;
        if (touchStart) {
          if (!touchStart.moved) {
            onApplyCell(cell.key);
          }
          touchStartRef.current = null;
          return;
        }
        onCommit();
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        onApplyCell(cell.key);
      }}
    />
  );
}

function getPointerTargetCellKey(event: React.PointerEvent<HTMLElement>) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  return target?.closest<HTMLElement>("[data-calendar-cell-key]")?.dataset
    .calendarCellKey;
}

function BrushControls({
  mode,
  disabled,
  onModeChange,
}: {
  mode: PaintMode;
  disabled: boolean;
  onModeChange: (mode: PaintMode) => void;
}) {
  const controls: {
    mode: PaintMode;
    label: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }[] = [
    { mode: "allow", label: "Allow", icon: Paintbrush },
    { mode: "block", label: "Block", icon: Eraser },
    { mode: "preview", label: "Preview", icon: MousePointer2 },
  ];

  return (
    <div className="flex w-full flex-wrap rounded-md border border-border bg-surface p-1 sm:w-auto">
      {controls.map((control) => {
        const Icon = control.icon;
        return (
          <button
            key={control.mode}
            type="button"
            disabled={disabled}
            aria-pressed={mode === control.mode}
            title={control.label}
            className={cn(
              "inline-flex h-9 min-w-[calc(50%-0.125rem)] flex-1 items-center justify-center gap-2 rounded px-3 text-sm font-medium text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-24 sm:flex-none",
              mode === control.mode && "bg-primary text-primary-foreground",
              mode !== control.mode && "hover:bg-surface-muted hover:text-foreground",
            )}
            onClick={() => onModeChange(control.mode)}
          >
            <Icon className="size-4" aria-hidden />
            {control.label}
          </button>
        );
      })}
    </div>
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
