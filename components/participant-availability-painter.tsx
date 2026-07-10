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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AdminCalendarPainter } from "@/components/admin-calendar-painter";
import { MembershipIdentityPanel } from "@/components/membership-identity-panel";
import { MeetingResultsPanel } from "@/components/meeting-results-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MeetingResults } from "@/lib/meeting-results";
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
import { getAnonymousClientRateLimitKey } from "@/lib/client-rate-limit-key";
import {
  forgetRememberedMembershipToken,
  readRememberedMembershipToken,
  rememberMembershipToken,
} from "@/lib/membership-session";

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
  hasEmailIdentity?: boolean;
};

type MembershipCapabilities = {
  canAdminister: boolean;
  canEditAvailability: boolean;
  canFinalize?: boolean;
  canReopen?: boolean;
};

type ParticipantData = {
  meeting: MeetingSummary;
  membership?: MembershipSummary;
  capabilities: MembershipCapabilities;
  ownAvailabilityRecords: PersistedAvailabilityRecord[];
  results?: MeetingResults;
};

type SaveAvailability = (
  membershipToken: string,
  records: AvailabilityRecordInput[],
) => Promise<unknown>;
type UpdateDisplayName = (
  membershipToken: string,
  displayName: string,
) => Promise<unknown>;
type FinalSlot = {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
};
type CreateAdminInviteToken = (
  membershipToken: string,
) => Promise<{ adminInviteToken: string }>;

const adminInviteUrlCache = new Map<string, string>();

export function ConnectedPublicParticipantMeeting({
  meetingSlug,
  adminInviteToken,
}: {
  meetingSlug: string;
  adminInviteToken?: string;
}) {
  const [clientAdminInviteToken] = useState(
    () =>
      adminInviteToken ??
      (typeof window === "undefined" ? null : readAdminInviteTokenFromLocation()),
  );
  const [rememberedMembershipToken, setRememberedMembershipToken] = useState(() =>
    typeof window === "undefined" ? null : readRememberedMembershipToken(meetingSlug),
  );
  const activeAdminInviteToken = clientAdminInviteToken ?? undefined;
  const activeRememberedMembershipToken = rememberedMembershipToken;
  const meetingData = useQuery(api.meetings.readPublicMeetingBySlug, {
    slug: meetingSlug,
  });
  const rememberedMeetingData = useQuery(
    api.meetings.readParticipantMeetingByMembershipToken,
    activeRememberedMembershipToken
      ? { membershipToken: activeRememberedMembershipToken }
      : "skip",
  );
  const createParticipantMembership = useMutation(
    api.meetings.createParticipantMembership,
  );
  const createAdminMembershipFromInvite = useMutation(
    api.meetings.createAdminMembershipFromInvite,
  );
  const createAdminInviteToken = useMutation(api.meetings.createAdminInviteToken);
  const saveAvailabilityRecords = useMutation(api.meetings.saveAvailabilityRecords);
  const updateMembershipDisplayName = useMutation(
    api.meetings.updateMembershipDisplayName,
  );
  const finalizeMeeting = useMutation(api.meetings.finalizeMeeting);
  const reopenMeeting = useMutation(api.meetings.reopenMeeting);
  const validRememberedMeetingData =
    rememberedMeetingData && rememberedMeetingData.meeting.slug === meetingSlug
      ? rememberedMeetingData
      : null;

  useEffect(() => {
    if (adminInviteToken || !readAdminInviteTokenFromLocation()) {
      return;
    }

    window.history.replaceState(
      window.history.state,
      "",
      buildUrlWithoutAdminInviteToken(),
    );
  }, [adminInviteToken]);

  useEffect(() => {
    if (!activeRememberedMembershipToken) {
      return;
    }
    if (
      rememberedMeetingData === undefined ||
      (rememberedMeetingData && rememberedMeetingData.meeting.slug === meetingSlug)
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      forgetRememberedMembershipToken(meetingSlug);
      setRememberedMembershipToken(null);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeRememberedMembershipToken, meetingSlug, rememberedMeetingData]);

  if (
    meetingData === undefined ||
    (activeRememberedMembershipToken && rememberedMeetingData === undefined)
  ) {
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

  if (activeRememberedMembershipToken && validRememberedMeetingData) {
    return (
      <ParticipantAvailabilityPainter
        data={validRememberedMeetingData}
        existingMembershipToken={activeRememberedMembershipToken}
        onSaveAvailability={(token, records) =>
          saveAvailabilityRecords({ membershipToken: token, records })
        }
        onUpdateDisplayName={(token, nextDisplayName) =>
          updateMembershipDisplayName({
            membershipToken: token,
            displayName: nextDisplayName,
          })
        }
        onFinalizeMeeting={(token, finalizedSlot) =>
          finalizeMeeting({ membershipToken: token, finalizedSlot })
        }
        onReopenMeeting={(token) => reopenMeeting({ membershipToken: token })}
        onCreateAdminInviteToken={(membershipToken) =>
          createAdminInviteToken({ membershipToken })
        }
        onMembershipTokenAvailable={(membershipToken, slug) => {
          rememberMembershipToken(slug, membershipToken);
          setRememberedMembershipToken(membershipToken);
        }}
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
        results: meetingData.results,
      }}
      adminInviteToken={activeAdminInviteToken}
      onCreateMembership={async (displayName) => {
        if (activeAdminInviteToken) {
          return createAdminMembershipFromInvite({
            meetingSlug: meetingData.meeting.slug,
            adminInviteToken: activeAdminInviteToken,
            displayName,
            privacyMode: "detailed",
            clientRateLimitKey: getAnonymousClientRateLimitKey(),
          });
        }
        return createParticipantMembership({
          meetingSlug: meetingData.meeting.slug,
          displayName,
          privacyMode: "detailed",
          clientRateLimitKey: getAnonymousClientRateLimitKey(),
        });
      }}
      onSaveAvailability={(membershipToken, records) =>
        saveAvailabilityRecords({ membershipToken, records })
      }
      onCreateAdminInviteToken={(membershipToken) =>
        createAdminInviteToken({ membershipToken })
      }
      onMembershipTokenAvailable={(membershipToken, slug) => {
        rememberMembershipToken(slug, membershipToken);
        setRememberedMembershipToken(membershipToken);
      }}
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
  const finalizeMeeting = useMutation(api.meetings.finalizeMeeting);
  const reopenMeeting = useMutation(api.meetings.reopenMeeting);
  const updateMembershipDisplayName = useMutation(
    api.meetings.updateMembershipDisplayName,
  );
  const createAdminInviteToken = useMutation(api.meetings.createAdminInviteToken);
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
        onFinalizeMeeting={(token, finalizedSlot) =>
          finalizeMeeting({ membershipToken: token, finalizedSlot })
        }
        onReopenMeeting={(token) => reopenMeeting({ membershipToken: token })}
        onCreateAdminInviteToken={(token) =>
          createAdminInviteToken({ membershipToken: token })
        }
        onMembershipTokenAvailable={(token, slug) => rememberMembershipToken(slug, token)}
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
  onFinalizeMeeting,
  onReopenMeeting,
  onCreateAdminInviteToken,
  onMembershipTokenAvailable,
  adminInviteToken,
  baseDate,
}: {
  data: ParticipantData;
  existingMembershipToken?: string;
  onCreateMembership?: (displayName: string) => Promise<{ membershipToken: string }>;
  onSaveAvailability: SaveAvailability;
  onUpdateDisplayName?: UpdateDisplayName;
  onFinalizeMeeting?: (
    membershipToken: string,
    finalizedSlot: FinalSlot,
  ) => Promise<unknown>;
  onReopenMeeting?: (membershipToken: string) => Promise<unknown>;
  onCreateAdminInviteToken?: CreateAdminInviteToken;
  onMembershipTokenAvailable?: (membershipToken: string, meetingSlug: string) => void;
  adminInviteToken?: string;
  baseDate?: Date;
}) {
  const { meeting } = data;
  const [mode, setMode] = useState<ParticipantPaintMode>("yes");
  const [rangeAnchorCellKey, setRangeAnchorCellKey] = useState<string | null>(null);
  const [isRangeSelectionActive, setIsRangeSelectionActive] = useState(false);
  const [displayName, setDisplayName] = useState(data.membership?.displayName ?? "");
  const [createdMembershipToken, setCreatedMembershipToken] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdMembershipCanAdminister, setCreatedMembershipCanAdminister] =
    useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const importedMembershipTokenRef = useRef<string | null>(null);

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
  const [hasSubmittedAvailability, setHasSubmittedAvailability] = useState(
    () => initialResponses.size > 0,
  );
  const summary = useMemo(
    () => summarizeAvailability(grid, paintState.responsesByCellKey),
    [grid, paintState.responsesByCellKey],
  );
  const canFinalizeMeeting = Boolean(
    membershipToken && data.capabilities.canFinalize && meeting.lifecycleState === "open",
  );
  const canReopenMeeting = Boolean(
    membershipToken &&
    data.capabilities.canReopen &&
    meeting.lifecycleState === "finalized",
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
    setHasSubmittedAvailability(initialResponses.size > 0);
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
  const publicParticipantUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return buildAbsoluteAppUrl(routes.meetingPoll(meeting.slug), window.location.origin);
  }, [meeting.slug]);
  const canShareAdminInvite =
    meeting.adminMode === "roleBased" &&
    Boolean(membershipToken) &&
    (data.capabilities.canAdminister || createdMembershipCanAdminister);

  useEffect(() => {
    if (!membershipToken || !onMembershipTokenAvailable) {
      return;
    }

    onMembershipTokenAvailable(membershipToken, meeting.slug);
  }, [meeting.slug, membershipToken, onMembershipTokenAvailable]);

  useEffect(() => {
    if (
      !membershipToken ||
      membershipToken !== createdMembershipToken ||
      importedMembershipTokenRef.current === membershipToken
    ) {
      return;
    }
    importedMembershipTokenRef.current = membershipToken;
    void fetch("/api/user/import-memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipTokens: [membershipToken] }),
    }).catch(() => {
      importedMembershipTokenRef.current = null;
    });
  }, [createdMembershipToken, membershipToken]);

  async function handleSave() {
    setError(null);
    setNotice(null);

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
        setCreatedMembershipCanAdminister(
          Boolean(adminInviteToken) || meeting.adminMode === "everyoneAdmin",
        );
      } else if (existingMembershipNeedsName) {
        await onUpdateDisplayName!(activeToken, normalizedDisplayName);
      }
      if (records.length > 0) {
        await onSaveAvailability(activeToken, records);
        const savedResponses = new Map(paintState.responsesByCellKey);
        savedResponsesRef.current = savedResponses;
        pendingSavedResponsesRef.current = savedResponses;
        setHasSubmittedAvailability(savedResponses.size > 0);
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

  function applyAllAllowed(response: ParticipantPaintMode) {
    if (!canEdit) {
      return;
    }
    setError(null);
    setNotice(null);
    setHasLocalEdits(true);
    dispatch({ type: "apply", cellKeys: grid.participantCellKeys, mode: response });
  }

  const resultsPanel = data.results ? (
    <MeetingResultsPanel
      results={data.results}
      canAdminister={data.capabilities.canAdminister}
      lifecycleState={meeting.lifecycleState}
      selectedSlot={meeting.finalizedSlot}
      canFinalize={canFinalizeMeeting}
      canReopen={canReopenMeeting}
      onFinalize={
        canFinalizeMeeting && onFinalizeMeeting && membershipToken
          ? (finalizedSlot) => onFinalizeMeeting(membershipToken, finalizedSlot)
          : undefined
      }
      onReopen={
        canReopenMeeting && onReopenMeeting && membershipToken
          ? () => onReopenMeeting(membershipToken)
          : undefined
      }
    />
  ) : null;

  return (
    <div className="space-y-6">
      <section className="grid gap-3">
        <div className="grid gap-2">
          <div className="flex flex-row gap-2 items-center">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {meeting.title}
            </h1>
            <div>
              {meeting.lifecycleState === "finalized" ? (
                <Badge>Participant response Finalized</Badge>
              ) : (
                <Badge variant="accent">Participant response Open</Badge>
              )}
            </div>
          </div>
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
      <p className="sr-only" aria-live="polite">
        {`${summary.yes} yes, ${summary.reluctant} reluctant, ${summary.no} no responses selected.`}
      </p>

      {hasSubmittedAvailability ? resultsPanel : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,330px)]">
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
              rangeAnchorCellKey={rangeAnchorCellKey}
              isRangeSelectionActive={isRangeSelectionActive}
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
              onRangeCell={(cellKey) => {
                setError(null);
                setNotice(null);
                if (!rangeAnchorCellKey) {
                  setRangeAnchorCellKey(cellKey);
                  return;
                }
                setHasLocalEdits(true);
                dispatch({
                  type: "applyRange",
                  anchorCellKey: rangeAnchorCellKey,
                  targetCellKey: cellKey,
                  grid,
                  mode,
                });
                setRangeAnchorCellKey(null);
                setIsRangeSelectionActive(false);
              }}
              onRangeStart={() => setIsRangeSelectionActive(true)}
              onRangeCancel={() => {
                setRangeAnchorCellKey(null);
                setIsRangeSelectionActive(false);
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
                    aria-invalid={error?.toLowerCase().includes("display name")}
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

          <MeetingLinksPanel
            publicParticipantUrl={publicParticipantUrl}
            personalMembershipUrl={personalMembershipUrl}
            canShareAdminInvite={canShareAdminInvite}
            membershipToken={membershipToken ?? null}
            meetingSlug={meeting.slug}
            onCreateAdminInviteToken={onCreateAdminInviteToken}
            onCopyError={() =>
              setError(
                "Clipboard access is unavailable. Select the link text to copy it.",
              )
            }
          />

          <MembershipIdentityPanel
            membershipToken={membershipToken ?? undefined}
            isEmailRecoveryAttached={data.membership?.hasEmailIdentity}
          />
        </aside>
      </div>

      {hasSubmittedAvailability ? null : resultsPanel}
    </div>
  );
}

function readAdminInviteTokenFromLocation(): string | null {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashToken = hashParams.get("adminInviteToken");
  if (hashToken) {
    return hashToken;
  }

  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get("adminInviteToken");
}

function buildUrlWithoutAdminInviteToken(): string {
  const queryParams = new URLSearchParams(window.location.search);
  queryParams.delete("adminInviteToken");
  const queryString = queryParams.toString();
  return `${window.location.pathname}${queryString ? `?${queryString}` : ""}`;
}

function MeetingLinksPanel({
  publicParticipantUrl,
  personalMembershipUrl,
  canShareAdminInvite,
  membershipToken,
  meetingSlug,
  onCreateAdminInviteToken,
  onCopyError,
}: {
  publicParticipantUrl: string | null;
  personalMembershipUrl: string | null;
  canShareAdminInvite: boolean;
  membershipToken: string | null;
  meetingSlug: string;
  onCreateAdminInviteToken?: CreateAdminInviteToken;
  onCopyError: () => void;
}) {
  const [adminInvite, setAdminInvite] = useState<{
    membershipToken: string;
    url: string;
  } | null>(null);
  const [adminInviteError, setAdminInviteError] = useState<string | null>(null);
  const [isPreparingAdminInvite, setIsPreparingAdminInvite] = useState(false);
  const [copiedLink, setCopiedLink] = useState<
    "public" | "adminInvite" | "personal" | null
  >(null);
  const requestedAdminInviteRef = useRef<string | null>(null);

  const prepareAdminInvite = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (
        !canShareAdminInvite ||
        !membershipToken ||
        !onCreateAdminInviteToken ||
        typeof window === "undefined"
      ) {
        return;
      }

      const cacheKey = `${meetingSlug}:${membershipToken}`;
      const cachedUrl = force ? null : adminInviteUrlCache.get(cacheKey);
      if (cachedUrl) {
        setAdminInvite({ membershipToken, url: cachedUrl });
        setAdminInviteError(null);
        return;
      }
      if (requestedAdminInviteRef.current === membershipToken && !force) {
        return;
      }

      requestedAdminInviteRef.current = membershipToken;
      setIsPreparingAdminInvite(true);
      try {
        const result = await onCreateAdminInviteToken(membershipToken);
        const origin = window.location.origin;
        const url = buildAbsoluteAppUrl(
          routes.adminInvite(meetingSlug, result.adminInviteToken),
          origin,
        );
        adminInviteUrlCache.set(cacheKey, url);
        setAdminInvite({ membershipToken, url });
        setAdminInviteError(null);
      } catch {
        requestedAdminInviteRef.current = null;
        setAdminInviteError("Unable to prepare the admin invite link.");
      } finally {
        setIsPreparingAdminInvite(false);
      }
    },
    [canShareAdminInvite, meetingSlug, membershipToken, onCreateAdminInviteToken],
  );

  useEffect(() => {
    if (
      !canShareAdminInvite ||
      !membershipToken ||
      !onCreateAdminInviteToken ||
      typeof window === "undefined"
    ) {
      return;
    }
    if (requestedAdminInviteRef.current === membershipToken) {
      return;
    }

    void prepareAdminInvite();
  }, [
    canShareAdminInvite,
    membershipToken,
    onCreateAdminInviteToken,
    prepareAdminInvite,
  ]);

  const adminInviteUrl =
    adminInvite?.membershipToken === membershipToken ? adminInvite.url : null;

  async function copyLink(
    kind: "public" | "adminInvite" | "personal",
    value: string | null,
  ) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLink(kind);
    } catch {
      onCopyError();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {publicParticipantUrl ? (
          <LinkField
            label="Regular invite link"
            value={publicParticipantUrl}
            copied={copiedLink === "public"}
            onCopy={() => copyLink("public", publicParticipantUrl)}
          />
        ) : null}

        {canShareAdminInvite ? (
          <LinkField
            label="Admin invite link"
            value={adminInviteUrl ?? ""}
            copied={copiedLink === "adminInvite"}
            disabled={!adminInviteUrl}
            placeholder="Preparing admin invite..."
            onCopy={() => copyLink("adminInvite", adminInviteUrl)}
          />
        ) : null}

        {canShareAdminInvite && adminInviteError ? (
          <div className="grid gap-2">
            <StatusMessage tone="error">{adminInviteError}</StatusMessage>
            <Button
              type="button"
              variant="secondary"
              disabled={isPreparingAdminInvite}
              onClick={() => void prepareAdminInvite({ force: true })}
            >
              {isPreparingAdminInvite ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Retry admin invite
            </Button>
          </div>
        ) : null}

        {personalMembershipUrl ? (
          <div className="border-t border-border pt-4">
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
              Your private return link is only for you. Do not share it as an invite.
            </div>
            <LinkField
              label="Private return link"
              value={personalMembershipUrl}
              copied={copiedLink === "personal"}
              onCopy={() => copyLink("personal", personalMembershipUrl)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LinkField({
  label,
  value,
  copied,
  onCopy,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex min-w-0 gap-2">
        <input
          className={cn(inputClassName, "min-w-0")}
          readOnly
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          aria-label={label}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="shrink-0"
          aria-label={`Copy ${label}`}
          disabled={disabled}
          onClick={onCopy}
        >
          {copied ? (
            <Check className="size-4 text-accent" aria-hidden="true" />
          ) : (
            <Clipboard className="size-4" aria-hidden="true" />
          )}
        </Button>
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
  rangeAnchorCellKey,
  isRangeSelectionActive,
  onBegin,
  onHover,
  onCommit,
  onCommittedEdit,
  onCancel,
  onApplyCell,
  onRangeCell,
  onRangeStart,
  onRangeCancel,
}: {
  grid: ParticipantAvailabilityGrid;
  mode: ParticipantPaintMode;
  disabled: boolean;
  responsesByCellKey: Map<string, AvailabilityResponse>;
  previewCellKeys: Set<string>;
  rangeAnchorCellKey: string | null;
  isRangeSelectionActive: boolean;
  onBegin: (cellKey: string) => void;
  onHover: (cellKey: string) => void;
  onCommit: () => void;
  onCommittedEdit: () => void;
  onCancel: () => void;
  onApplyCell: (cellKey: string) => void;
  onRangeCell: (cellKey: string) => void;
  onRangeStart: () => void;
  onRangeCancel: () => void;
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
    <>
      <div className="border-b border-border bg-surface-muted px-4 py-3 text-sm text-slate-600 sm:hidden">
        {rangeAnchorCellKey ? (
          <div className="flex items-center justify-between gap-3">
            <span>Range start selected. Scroll, then tap the end cell.</span>
            <Button type="button" variant="ghost" size="sm" onClick={onRangeCancel}>
              Cancel
            </Button>
          </div>
        ) : isRangeSelectionActive ? (
          <div className="flex items-center justify-between gap-3">
            <span>Tap the first cell in the range.</span>
            <Button type="button" variant="ghost" size="sm" onClick={onRangeCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span>Tap a cell to mark it.</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={onRangeStart}
            >
              Mark a range
            </Button>
          </div>
        )}
      </div>
      <div
        className="max-h-[72vh] w-full min-w-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain"
        onPointerLeave={() => {
          if (!disabled) {
            onCancel();
          }
        }}
      >
        <div
          className="grid min-w-[640px] sm:min-w-[720px]"
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
              onRangeCell={onRangeCell}
              rangeAnchorCellKey={rangeAnchorCellKey}
              isRangeSelectionActive={isRangeSelectionActive}
            />
          ))}
        </div>
      </div>
    </>
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
  onRangeCell,
  rangeAnchorCellKey,
  isRangeSelectionActive,
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
  onRangeCell: (cellKey: string) => void;
  rangeAnchorCellKey: string | null;
  isRangeSelectionActive: boolean;
}) {
  return (
    <>
      <div className="sticky left-0 z-10 min-h-10 border-b border-r border-border bg-surface-muted px-3 py-2 text-xs font-medium text-slate-500 sm:min-h-8 sm:py-1">
        {timeKey}
      </div>
      {visibleDays.map((day) => {
        const cell = grid.cellsByDateTime.get(`${day.dateKey}_${timeKey}`);
        if (!cell || !grid.participantCellKeys.has(cell.key)) {
          return (
            <div
              key={`${day.dateKey}_${timeKey}`}
              className="min-h-10 border-b border-r border-border bg-slate-100 sm:min-h-8"
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
            onRangeCell={onRangeCell}
            isRangeStart={rangeAnchorCellKey === cell.key}
            isRangeSelectionActive={isRangeSelectionActive}
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
  onRangeCell,
  isRangeStart,
  isRangeSelectionActive,
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
  onRangeCell: (cellKey: string) => void;
  isRangeStart: boolean;
  isRangeSelectionActive: boolean;
}) {
  const displayedResponse = isPreview && mode !== "clear" ? mode : response;
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
      aria-selected={Boolean(response)}
      aria-label={`${cell.dayLabel} ${cell.timeLabel} ${displayedResponse ?? "unset"}`}
      title={`${cell.dayLabel} ${cell.timeLabel}`}
      className={cn(
        "min-h-10 touch-manipulation select-none border-b border-r border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed sm:min-h-8",
        responseClassName(displayedResponse),
        !displayedResponse && cell.isWeekend && "bg-slate-50",
        isPreview && mode === "clear" && "bg-slate-200",
        isRangeStart && "ring-2 ring-inset ring-primary",
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
            if (isRangeSelectionActive) {
              onRangeCell(cell.key);
            } else {
              onApplyCell(cell.key);
            }
          }
          touchStartRef.current = null;
          return;
        }
        onCommittedEdit();
        onCommit();
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        if (isRangeSelectionActive) {
          onRangeCell(cell.key);
        } else {
          onApplyCell(cell.key);
        }
      }}
    />
  );
}

function getPointerTargetCellKey(event: React.PointerEvent<HTMLElement>) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  return target?.closest<HTMLElement>("[data-calendar-cell-key]")?.dataset
    .calendarCellKey;
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
      aria-live={tone === "error" ? "assertive" : "polite"}
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
