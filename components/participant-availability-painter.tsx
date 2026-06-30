"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clipboard,
  Eraser,
  Loader2,
  Paintbrush,
  Save,
  Settings2,
  Smile,
  ThumbsDown,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import type React from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AdminCalendarPainter } from "@/components/admin-calendar-painter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AllowedTimeRangeDraft } from "@/lib/meeting-presets";
import {
  availabilityPaintReducer,
  availabilityRecordsToResponseMap,
  availabilityStateToSaveRequests,
  buildParticipantAvailabilityGrid,
  createInitialAvailabilityPaintState,
  summarizeAvailability,
  type AvailabilityRecordInput,
  type AvailabilityResponse,
  type ParticipantAvailabilityGrid,
  type ParticipantPaintMode,
  type PersistedAvailabilityRecord,
} from "@/lib/participant-availability-painter";
import { buildAbsoluteAppUrl, routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type MeetingSummary = {
  _id?: string;
  title: string;
  slug: string;
  description?: string;
  lifecycleState: "open" | "finalized";
  lifecycleRevision?: number;
  adminMode: "roleBased" | "everyoneAdmin";
  canonicalTimeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  allowedTimeRanges: AllowedTimeRangeDraft[];
  finalizedAt?: number;
  finalizedSlot?: {
    startUtc: string;
    endUtc: string;
    timeZone?: string;
  };
  createdAt?: number;
  updatedAt?: number;
};

type MembershipSummary = {
  role: "admin" | "member";
  displayName?: string;
};

type MembershipCapabilities = {
  canAdminister: boolean;
  canEditAvailability: boolean;
  canReopen?: boolean;
};

type ParticipantData = {
  meeting: MeetingSummary;
  membership?: MembershipSummary;
  capabilities: MembershipCapabilities;
  ownAvailabilityRecords: PersistedAvailabilityRecord[];
};

type SaveAvailability = (
  membershipToken: string,
  records: AvailabilityRecordInput[],
) => Promise<unknown>;
type UpdateDisplayName = (
  membershipToken: string,
  displayName: string,
) => Promise<unknown>;

export function ConnectedPublicParticipantMeeting({
  meetingSlug,
}: {
  meetingSlug: string;
}) {
  const meetingData = useQuery(api.meetings.readPublicMeetingBySlug, {
    slug: meetingSlug,
  });
  const createParticipantMembership = useMutation(
    api.meetings.createParticipantMembership,
  );
  const saveAvailabilityRecords = useMutation(api.meetings.saveAvailabilityRecords);

  if (meetingData === undefined) {
    return <LoadingPanel label="Loading meeting" />;
  }

  if (meetingData === null) {
    return (
      <PermissionPanel
        title="Meeting unavailable"
        description="This public meeting link does not point to an active poll."
      />
    );
  }

  return (
    <ParticipantAvailabilityPainter
      data={{
        meeting: meetingData.meeting,
        capabilities: {
          canAdminister: false,
          canEditAvailability: meetingData.meeting.lifecycleState === "open",
        },
        ownAvailabilityRecords: [],
      }}
      onCreateMembership={async (displayName) =>
        createParticipantMembership({
          meetingSlug: meetingData.meeting.slug,
          displayName,
          privacyMode: "detailed",
        })
      }
      onSaveAvailability={(membershipToken, records) =>
        saveAvailabilityRecords({ membershipToken, records })
      }
    />
  );
}

export function ConnectedMembershipAvailability({
  membershipToken,
}: {
  membershipToken: string;
}) {
  const meetingData = useQuery(api.meetings.readParticipantMeetingByMembershipToken, {
    membershipToken,
  });
  const saveAvailabilityRecords = useMutation(api.meetings.saveAvailabilityRecords);
  const updateMeetingSettings = useMutation(api.meetings.updateMeetingSettings);
  const updateMembershipDisplayName = useMutation(
    api.meetings.updateMembershipDisplayName,
  );
  const [showAdminSetup, setShowAdminSetup] = useState(false);

  if (meetingData === undefined) {
    return <LoadingPanel label="Loading membership link" />;
  }

  if (meetingData === null) {
    return (
      <PermissionPanel
        title="Membership link unavailable"
        description="This secret membership link is invalid, revoked, or no longer points to a meeting."
      />
    );
  }

  const canAdminister = meetingData.capabilities.canAdminister;

  return (
    <div className="space-y-6">
      <ParticipantAvailabilityPainter
        data={meetingData}
        existingMembershipToken={membershipToken}
        onSaveAvailability={(token, records) =>
          saveAvailabilityRecords({ membershipToken: token, records })
        }
        onUpdateDisplayName={(token, nextDisplayName) =>
          updateMembershipDisplayName({
            membershipToken: token,
            displayName: nextDisplayName,
          })
        }
      />

      {canAdminister ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="size-5 text-primary" aria-hidden="true" />
              Admin Access
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-slate-600">
              This membership can also edit the admin-allowed calendar regions.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAdminSetup((value) => !value)}
            >
              <Settings2 className="size-4" aria-hidden="true" />
              {showAdminSetup ? "Hide admin setup" : "Open admin setup"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canAdminister && showAdminSetup ? (
        <AdminCalendarPainter
          data={{
            meeting: meetingData.meeting,
            membership: meetingData.membership,
            capabilities: {
              canAdminister: meetingData.capabilities.canAdminister,
              canReopen: Boolean(meetingData.capabilities.canReopen),
            },
          }}
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
      ) : null}
    </div>
  );
}

export function ParticipantAvailabilityPainter({
  data,
  existingMembershipToken,
  onCreateMembership,
  onSaveAvailability,
  onUpdateDisplayName,
  baseDate,
}: {
  data: ParticipantData;
  existingMembershipToken?: string;
  onCreateMembership?: (displayName: string) => Promise<{ membershipToken: string }>;
  onSaveAvailability: SaveAvailability;
  onUpdateDisplayName?: UpdateDisplayName;
  baseDate?: Date;
}) {
  const { meeting } = data;
  const [mode, setMode] = useState<ParticipantPaintMode>("yes");
  const [displayName, setDisplayName] = useState(data.membership?.displayName ?? "");
  const [createdMembershipToken, setCreatedMembershipToken] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);

  const membershipToken = existingMembershipToken ?? createdMembershipToken;
  const canEdit =
    data.capabilities.canEditAvailability && meeting.lifecycleState === "open";
  const grid = useMemo(
    () =>
      buildParticipantAvailabilityGrid({
        timeZone: meeting.canonicalTimeZone,
        granularityMinutes: meeting.granularityMinutes,
        durationMinutes: meeting.durationMinutes,
        allowedTimeRanges: meeting.allowedTimeRanges,
        baseDate,
        minDays: 1,
      }),
    [
      baseDate,
      meeting.allowedTimeRanges,
      meeting.canonicalTimeZone,
      meeting.durationMinutes,
      meeting.granularityMinutes,
    ],
  );
  const initialResponses = useMemo(
    () =>
      availabilityRecordsToResponseMap(
        data.ownAvailabilityRecords,
        grid.participantCellKeys,
      ),
    [data.ownAvailabilityRecords, grid.participantCellKeys],
  );
  const savedResponsesRef = useRef(initialResponses);
  const pendingSavedResponsesRef = useRef<Map<string, AvailabilityResponse> | null>(null);
  const [paintState, dispatch] = useReducer(
    availabilityPaintReducer,
    initialResponses,
    createInitialAvailabilityPaintState,
  );
  const summary = useMemo(
    () => summarizeAvailability(grid, paintState.responsesByCellKey),
    [grid, paintState.responsesByCellKey],
  );

  useEffect(() => {
    if (hasLocalEdits) {
      return;
    }
    if (
      pendingSavedResponsesRef.current &&
      !areResponseMapsEqual(initialResponses, pendingSavedResponsesRef.current)
    ) {
      return;
    }
    pendingSavedResponsesRef.current = null;
    dispatch({ type: "replace", responsesByCellKey: initialResponses });
    savedResponsesRef.current = initialResponses;
  }, [hasLocalEdits, initialResponses]);

  const personalMembershipUrl = useMemo(() => {
    if (!membershipToken || typeof window === "undefined") {
      return null;
    }
    return buildAbsoluteAppUrl(
      routes.membershipLink(membershipToken),
      window.location.origin,
    );
  }, [membershipToken]);

  async function handleSave() {
    setError(null);
    setNotice(null);
    setCopied(false);

    if (!canEdit) {
      setError("This meeting is read-only until an admin reopens it.");
      return;
    }

    let activeToken = membershipToken;
    const wasNewJoin = !activeToken;
    const normalizedDisplayName = displayName.trim();
    const existingMembershipNeedsName = Boolean(
      data.membership && !data.membership.displayName,
    );
    if (!activeToken || existingMembershipNeedsName) {
      if (!normalizedDisplayName) {
        setError("Enter your display name before saving availability.");
        return;
      }
    }

    if (!activeToken) {
      if (!onCreateMembership) {
        setError("This membership link cannot create a new participant.");
        return;
      }
    } else if (existingMembershipNeedsName && !onUpdateDisplayName) {
      setError("This membership link cannot update a display name.");
      return;
    }

    const records = availabilityStateToSaveRequests({
      grid,
      responsesByCellKey: paintState.responsesByCellKey,
      originalResponsesByCellKey: savedResponsesRef.current,
    });

    setIsSaving(true);
    try {
      if (!activeToken) {
        const result = await onCreateMembership!(normalizedDisplayName);
        activeToken = result.membershipToken;
        setCreatedMembershipToken(activeToken);
      } else if (existingMembershipNeedsName) {
        await onUpdateDisplayName!(activeToken, normalizedDisplayName);
      }
      if (records.length > 0) {
        await onSaveAvailability(activeToken, records);
        const savedResponses = new Map(paintState.responsesByCellKey);
        savedResponsesRef.current = savedResponses;
        pendingSavedResponsesRef.current = savedResponses;
        setHasLocalEdits(false);
        setNotice("Availability saved.");
      } else if (wasNewJoin) {
        setNotice("Joined meeting.");
      } else if (existingMembershipNeedsName) {
        setNotice("Display name saved.");
      } else {
        setNotice("No availability changes to save.");
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Saving availability failed.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function copyPersonalLink() {
    if (!personalMembershipUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(personalMembershipUrl);
      setCopied(true);
      setError(null);
    } catch {
      setError("Clipboard access is unavailable. Select the link text to copy it.");
    }
  }

  function applyAllAllowed(response: ParticipantPaintMode) {
    if (!canEdit) {
      return;
    }
    setError(null);
    setNotice(null);
    setHasLocalEdits(true);
    dispatch({ type: "apply", cellKeys: grid.participantCellKeys, mode: response });
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent">Participant response</Badge>
          {meeting.lifecycleState === "finalized" ? (
            <Badge>Finalized</Badge>
          ) : (
            <Badge>Open</Badge>
          )}
        </div>
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            {meeting.title}
          </h1>
          {meeting.description ? (
            <p className="max-w-4xl text-sm leading-6 text-slate-600">
              {meeting.description}
            </p>
          ) : null}
          <p className="max-w-4xl text-sm leading-6 text-slate-600">
            Paint your availability in {meeting.canonicalTimeZone}. Each cell is{" "}
            {meeting.granularityMinutes} minutes; candidate meetings last{" "}
            {meeting.durationMinutes} minutes.
          </p>
        </div>
      </section>

      {meeting.lifecycleState === "finalized" ? (
        <PermissionPanel
          title="Finalized meeting"
          description="Responses are read-only until an admin reopens the poll."
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="size-5 text-primary" aria-hidden="true" />
                Availability Calendar
              </CardTitle>
              <AvailabilityBrushControls
                mode={mode}
                disabled={!canEdit}
                onModeChange={setMode}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <AvailabilityGrid
              grid={grid}
              mode={mode}
              disabled={!canEdit}
              responsesByCellKey={paintState.responsesByCellKey}
              previewCellKeys={paintState.previewCellKeys}
              onBegin={(cellKey) => {
                setError(null);
                setNotice(null);
                dispatch({ type: "begin", cellKey, mode });
              }}
              onHover={(cellKey) => dispatch({ type: "hover", cellKey, grid })}
              onCommit={() => dispatch({ type: "commit" })}
              onCommittedEdit={() => setHasLocalEdits(true)}
              onCancel={() => dispatch({ type: "cancel" })}
              onApplyCell={(cellKey) => {
                setError(null);
                setNotice(null);
                setHasLocalEdits(true);
                dispatch({ type: "apply", cellKeys: [cellKey], mode });
              }}
            />
          </CardContent>
        </Card>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Your Response</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!data.membership || !data.membership.displayName ? (
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">
                    Display name
                  </span>
                  <input
                    className={inputClassName}
                    value={displayName}
                    disabled={!canEdit}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Ada Lovelace"
                  />
                </label>
              ) : (
                <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
                  <span className="text-slate-500">Signed in as </span>
                  <span className="font-medium text-foreground">
                    {data.membership.displayName || "Anonymous participant"}
                  </span>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <SummaryItem label="Yes" value={summary.yes} />
                <SummaryItem label="Reluctant" value={summary.reluctant} />
                <SummaryItem label="No" value={summary.no} />
                <SummaryItem label="Unset" value={summary.clear} />
              </dl>

              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canEdit}
                  onClick={() => applyAllAllowed("yes")}
                >
                  <Paintbrush className="size-4" aria-hidden="true" />
                  Mark all yes
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => applyAllAllowed("clear")}
                >
                  <Eraser className="size-4" aria-hidden="true" />
                  Clear all
                </Button>
              </div>

              {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
              {notice ? <StatusMessage tone="success">{notice}</StatusMessage> : null}

              <Button
                type="button"
                className="w-full"
                disabled={!canEdit || isSaving}
                onClick={handleSave}
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {membershipToken ? "Save response" : "Join and save"}
              </Button>
            </CardContent>
          </Card>

          {personalMembershipUrl ? (
            <Card>
              <CardHeader>
                <CardTitle>Personal Link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 text-slate-600">
                  Use this private link to return and edit your own response.
                </p>
                <div className="flex gap-2">
                  <input
                    className={inputClassName}
                    readOnly
                    value={personalMembershipUrl}
                    aria-label="Personal membership link"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="Copy personal membership link"
                    onClick={copyPersonalLink}
                  >
                    {copied ? (
                      <Check className="size-4 text-accent" aria-hidden="true" />
                    ) : (
                      <Clipboard className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function AvailabilityGrid({
  grid,
  mode,
  disabled,
  responsesByCellKey,
  previewCellKeys,
  onBegin,
  onHover,
  onCommit,
  onCommittedEdit,
  onCancel,
  onApplyCell,
}: {
  grid: ParticipantAvailabilityGrid;
  mode: ParticipantPaintMode;
  disabled: boolean;
  responsesByCellKey: Map<string, AvailabilityResponse>;
  previewCellKeys: Set<string>;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onCommittedEdit: () => void;
  onCancel: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  const visibleDays = grid.days.filter((day) =>
    grid.timeKeys.some((timeKey) => {
      const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
      return cell ? grid.participantCellKeys.has(cell.key) : false;
    }),
  );
  const visibleTimeKeys = grid.timeKeys.filter((timeKey) =>
    visibleDays.some((day) => {
      const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
      return cell ? grid.participantCellKeys.has(cell.key) : false;
    }),
  );

  if (grid.participantCellKeys.size === 0) {
    return (
      <div className="p-5 text-sm leading-6 text-slate-600">
        No admin-allowed time cells are available for participants yet.
      </div>
    );
  }

  const columnTemplate = `76px repeat(${visibleDays.length}, minmax(72px, 1fr))`;
  return (
    <div
      className="max-h-[72vh] overflow-auto"
      onPointerLeave={() => {
        if (!disabled) {
          onCancel();
        }
      }}
    >
      <div
        className="grid min-w-[720px]"
        style={{ gridTemplateColumns: columnTemplate }}
        role="grid"
        aria-label="Participant availability calendar"
      >
        <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-surface-muted px-3 py-2 text-xs font-medium text-slate-600">
          Time
        </div>
        {visibleDays.map((day) => (
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
        {visibleTimeKeys.map((timeKey) => (
          <AvailabilityRow
            key={timeKey}
            grid={grid}
            visibleDays={visibleDays}
            timeKey={timeKey}
            mode={mode}
            disabled={disabled}
            responsesByCellKey={responsesByCellKey}
            previewCellKeys={previewCellKeys}
            onBegin={onBegin}
            onHover={onHover}
            onCommit={onCommit}
            onCommittedEdit={onCommittedEdit}
            onApplyCell={onApplyCell}
          />
        ))}
      </div>
    </div>
  );
}

function AvailabilityRow({
  grid,
  visibleDays,
  timeKey,
  mode,
  disabled,
  responsesByCellKey,
  previewCellKeys,
  onBegin,
  onHover,
  onCommit,
  onCommittedEdit,
  onApplyCell,
}: {
  grid: ParticipantAvailabilityGrid;
  visibleDays: ParticipantAvailabilityGrid["days"];
  timeKey: string;
  mode: ParticipantPaintMode;
  disabled: boolean;
  responsesByCellKey: Map<string, AvailabilityResponse>;
  previewCellKeys: Set<string>;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onCommittedEdit: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 min-h-8 border-b border-r border-border bg-surface-muted px-3 py-1 text-xs font-medium text-slate-500">
        {timeKey}
      </div>
      {visibleDays.map((day) => {
        const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
        if (!cell || !grid.participantCellKeys.has(cell.key)) {
          return (
            <div
              key={`${day.dateKey}_${timeKey}`}
              className="min-h-8 border-b border-r border-border bg-slate-100"
              aria-hidden="true"
            />
          );
        }

        return (
          <AvailabilityCellButton
            key={cell.key}
            cell={cell}
            mode={mode}
            disabled={disabled}
            response={responsesByCellKey.get(cell.key)}
            isPreview={previewCellKeys.has(cell.key)}
            onBegin={onBegin}
            onHover={onHover}
            onCommit={onCommit}
            onCommittedEdit={onCommittedEdit}
            onApplyCell={onApplyCell}
          />
        );
      })}
    </>
  );
}

function AvailabilityCellButton({
  cell,
  mode,
  disabled,
  response,
  isPreview,
  onBegin,
  onHover,
  onCommit,
  onCommittedEdit,
  onApplyCell,
}: {
  cell: { key: string; dayLabel: string; timeLabel: string; isWeekend: boolean };
  mode: ParticipantPaintMode;
  disabled: boolean;
  response?: AvailabilityResponse;
  isPreview: boolean;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onCommittedEdit: () => void;
  onApplyCell: (cellKey: string) => void;
}) {
  const displayedResponse = isPreview && mode !== "clear" ? mode : response;
  return (
    <button
      type="button"
      role="gridcell"
      disabled={disabled}
      aria-selected={Boolean(response)}
      aria-label={`${cell.dayLabel} ${cell.timeLabel} ${displayedResponse ?? "unset"}`}
      title={`${cell.dayLabel} ${cell.timeLabel}`}
      className={cn(
        "min-h-8 border-b border-r border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed",
        responseClassName(displayedResponse),
        !displayedResponse && cell.isWeekend && "bg-slate-50",
        isPreview && mode === "clear" && "bg-slate-200",
      )}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        onBegin(cell.key);
      }}
      onPointerEnter={(event) => {
        if (!disabled && event.buttons === 1) {
          onHover(cell.key);
        }
      }}
      onPointerUp={() => {
        if (!disabled) {
          onCommittedEdit();
          onCommit();
        }
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

function AvailabilityBrushControls({
  mode,
  disabled,
  onModeChange,
}: {
  mode: ParticipantPaintMode;
  disabled: boolean;
  onModeChange: (mode: ParticipantPaintMode) => void;
}) {
  const controls: {
    mode: ParticipantPaintMode;
    label: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }[] = [
    { mode: "yes", label: "Yes", icon: Paintbrush },
    { mode: "reluctant", label: "Reluctant", icon: Smile },
    { mode: "no", label: "No", icon: ThumbsDown },
    { mode: "clear", label: "Clear", icon: Eraser },
  ];

  return (
    <div className="inline-flex flex-wrap rounded-md border border-border bg-surface p-1">
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
              "inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded px-3 text-sm font-medium text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
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

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-64 items-center justify-center gap-3 pt-5 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </CardContent>
    </Card>
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
    >
      {children}
    </div>
  );
}

function responseClassName(response?: AvailabilityResponse) {
  if (response === "yes") {
    return "bg-teal-500 hover:bg-teal-600";
  }
  if (response === "reluctant") {
    return "bg-amber-300 hover:bg-amber-400";
  }
  if (response === "no") {
    return "bg-rose-400 hover:bg-rose-500";
  }
  return "bg-surface hover:bg-blue-50";
}

function areResponseMapsEqual(
  left: Map<string, AvailabilityResponse>,
  right: Map<string, AvailabilityResponse>,
) {
  if (left.size !== right.size) {
    return false;
  }
  for (const [cellKey, response] of left) {
    if (right.get(cellKey) !== response) {
      return false;
    }
  }
  return true;
}

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
