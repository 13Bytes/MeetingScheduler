"use client";

import {
  CalendarCheck2,
  CheckCircle2,
  EyeOff,
  Loader2,
  RotateCcw,
  SmilePlus,
  UsersRound,
  CircleUserRound,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MeetingResults, ScoredCandidateSlot } from "@/lib/meeting-results";
import { cn } from "@/lib/utils";

type FinalSlot = {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
};

export function MeetingResultsPanel({
  results,
  canAdminister = false,
  lifecycleState = "open",
  selectedSlot,
  canFinalize = false,
  canReopen = false,
  onFinalize,
  onReopen,
}: {
  results: MeetingResults;
  canAdminister?: boolean;
  lifecycleState?: "open" | "finalized";
  selectedSlot?: FinalSlot;
  canFinalize?: boolean;
  canReopen?: boolean;
  onFinalize?: (slot: FinalSlot) => Promise<unknown>;
  onReopen?: () => Promise<unknown>;
}) {
  const hasParticipants = results.totalParticipantCount > 0;
  const hasVotes = results.availabilityCount > 0;
  const hasCandidates = results.candidateCount > 0;
  const recommendedShortlist = results.shortlist.filter(
    (candidate) => candidate.availableParticipantCount > 0,
  );
  const heatmapCandidates = results.candidates.filter(
    (candidate) => candidate.availableParticipantCount > 0,
  );
  const shouldShowShortlist = hasVotes && !selectedSlot;
  const shouldShowWaitingState = hasParticipants && !hasVotes && !selectedSlot;
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const defaultCandidate = recommendedShortlist[0] ?? results.candidates[0];
  const selectedCandidate =
    (selectedCandidateKey
      ? results.candidates.find(
          (candidate) => candidateKey(candidate) === selectedCandidateKey,
        )
      : undefined) ?? defaultCandidate;
  const activeCandidateKey = selectedCandidate ? candidateKey(selectedCandidate) : null;

  async function handleFinalize() {
    if (!selectedCandidate || !onFinalize) {
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    try {
      await onFinalize({
        startUtc: selectedCandidate.startUtc,
        endUtc: selectedCandidate.endUtc,
        timeZone: results.timeZone,
      });
      setStatus({ tone: "success", message: "Final meeting time saved." });
    } catch (caughtError) {
      setStatus({
        tone: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Finalizing the meeting failed.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReopen() {
    if (!onReopen) {
      return;
    }
    setIsSubmitting(true);
    setStatus(null);
    try {
      await onReopen();
      setStatus({ tone: "success", message: "Meeting reopened for responses." });
    } catch (caughtError) {
      setStatus({
        tone: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to reopen the meeting.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="grid gap-4">
      {selectedSlot ? (
        <FinalSlotBanner
          slot={selectedSlot}
          fallbackTimeZone={results.timeZone}
          canReopen={canReopen}
          isSubmitting={isSubmitting}
          onReopen={handleReopen}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {shouldShowShortlist ? (
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <CardTitle className="flex items-start gap-2">
                    <CalendarCheck2 className="size-5 text-primary" aria-hidden="true" />
                    <span>Best times</span>
                  </CardTitle>
                  <p className="text-sm leading-6 text-slate-600">
                    The strongest options based on everyone&apos;s availability.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canAdminister ? <Badge variant="accent">Organizer</Badge> : null}
                  {!results.detailsVisible ? (
                    <Badge>
                      <EyeOff className="size-3.5" aria-hidden="true" />
                      Summary only
                    </Badge>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              {hasParticipants && !hasCandidates ? (
                <EmptyResultsMessage message="The selected time windows are too short for this meeting." />
              ) : null}
              {hasParticipants && hasCandidates && recommendedShortlist.length === 0 ? (
                <EmptyResultsMessage message="No available times match the responses yet." />
              ) : null}
              {recommendedShortlist.map((candidate) => (
                <CandidateRow
                  key={`${candidate.startUtc}_${candidate.endUtc}`}
                  candidate={candidate}
                  timeZone={results.timeZone}
                  showDetails={results.detailsVisible}
                  canSelect={canFinalize && lifecycleState === "open"}
                  isSelected={
                    canFinalize &&
                    lifecycleState === "open" &&
                    candidateKey(candidate) === activeCandidateKey
                  }
                  onSelect={() => setSelectedCandidateKey(candidateKey(candidate))}
                />
              ))}
            </CardContent>
          </Card>
        ) : shouldShowWaitingState ? (
          <Card>
            <CardHeader>
              <CardTitle>Waiting for responses</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyResultsMessage message="Recommendations will appear after someone saves availability." />
            </CardContent>
          </Card>
        ) : null}

        {hasVotes ? (
          <aside className="space-y-4">
            {canAdminister &&
            (canFinalize || canReopen || lifecycleState === "finalized") ? (
              <Card>
                <CardHeader>
                  <CardTitle>Choose the final time</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {lifecycleState === "finalized" ? (
                    <p className="text-sm leading-6 text-slate-600">
                      The final time is set. An organizer can reopen responses if plans
                      change.
                    </p>
                  ) : hasCandidates ? (
                    <>
                      <label className="grid gap-2">
                        <span className="text-sm font-medium text-foreground">
                          Meeting time
                        </span>
                        <select
                          className={inputClassName}
                          value={activeCandidateKey ?? ""}
                          onChange={(event) =>
                            setSelectedCandidateKey(event.target.value)
                          }
                          disabled={!canFinalize || isSubmitting}
                          aria-label="Override final slot"
                        >
                          {results.candidates.map((candidate) => (
                            <option
                              key={candidateKey(candidate)}
                              value={candidateKey(candidate)}
                            >
                              {formatCandidateWindow(candidate, results.timeZone)} ·{" "}
                              {candidate.availableParticipantCount}/
                              {candidate.totalParticipantCount} able
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedCandidate ? (
                        <FinalConfirmation
                          candidate={selectedCandidate}
                          timeZone={results.timeZone}
                          durationMinutes={results.durationMinutes}
                        />
                      ) : null}
                      <Button
                        type="button"
                        className="w-full"
                        disabled={!canFinalize || !selectedCandidate || isSubmitting}
                        onClick={handleFinalize}
                      >
                        {isSubmitting ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        )}
                        Finalize selected time
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm leading-6 text-slate-600">
                      Add available times before choosing the final meeting time.
                    </p>
                  )}
                  {status ? (
                    <StatusMessage tone={status.tone}>{status.message}</StatusMessage>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <VotedParticipantsCard results={results} />

            <Card>
              <CardHeader>
                <CardTitle>Availability comparison</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {heatmapCandidates.slice(0, 12).map((candidate) => (
                  <HeatmapBar
                    key={`${candidate.startUtc}_${candidate.endUtc}`}
                    candidate={candidate}
                    timeZone={results.timeZone}
                  />
                ))}
                {heatmapCandidates.length > 12 ? (
                  <p className="text-xs leading-5 text-slate-500">
                    Showing the 12 best-matching times out of {heatmapCandidates.length}.
                  </p>
                ) : null}
                {hasParticipants && hasCandidates && heatmapCandidates.length === 0 ? (
                  <p className="text-sm leading-6 text-slate-600">
                    No available times match the responses yet.
                  </p>
                ) : null}
                {hasParticipants && hasCandidates ? null : (
                  <p className="text-sm leading-6 text-slate-600">
                    {hasParticipants && !hasCandidates
                      ? "The selected time windows are too short for this meeting."
                      : "This comparison will appear once participants share their availability."}
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        ) : shouldShowWaitingState ? (
          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Awaiting Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-slate-600">
                  The best times will appear after someone shares their availability.
                </p>
              </CardContent>
            </Card>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function VotedParticipantsCard({ results }: { results: MeetingResults }) {
  const votedParticipants = results.votedParticipants ?? [];
  const votedParticipantCount = results.votedParticipantCount ?? 0;
  const canShowNames = results.detailsVisible && votedParticipants.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Responses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canShowNames ? (
          <div className="flex flex-wrap gap-2">
            {votedParticipants.map((participant) => (
              <Badge key={participant.membershipId} className="gap-2">
                <CircleUserRound
                  data-icon="inline-start"
                  className="size-4"
                  aria-hidden="true"
                />
                {participant.displayName ?? "Unnamed participant"}
              </Badge>
            ))}
          </div>
        ) : results.detailsVisible ? (
          <p className="text-sm leading-6 text-slate-600">No one has responded yet.</p>
        ) : (
          <p className="text-xs leading-5 text-slate-500">
            Names are hidden for summary-only results.
          </p>
        )}
        <p className="text-sm leading-6 text-slate-600">
          {votedParticipantCount} of {results.totalParticipantCount}{" "}
          {results.totalParticipantCount === 1 ? "participant has" : "participants have"}{" "}
          responded.
        </p>
      </CardContent>
    </Card>
  );
}

function CandidateRow({
  candidate,
  timeZone,
  showDetails,
  canSelect,
  isSelected,
  onSelect,
}: {
  candidate: ScoredCandidateSlot;
  timeZone: string;
  showDetails: boolean;
  canSelect: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-md border bg-surface-muted p-4",
        isSelected ? "border-primary" : "border-border",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              {formatCandidateWindow(candidate, timeZone)}
            </h3>
            {isSelected && canSelect ? <Badge variant="accent">Selected</Badge> : null}
          </div>
          <p className="text-sm text-slate-600">
            {candidate.availableParticipantCount} of {candidate.totalParticipantCount} can
            attend
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Metric
            icon={UsersRound}
            label="Able"
            value={candidate.availableParticipantCount}
          />
          <Metric
            icon={SmilePlus}
            label="If needed"
            value={candidate.reluctantVoteCount}
          />
          <Metric label="Match" value={`${candidate.scorePercent}%`} />
        </div>
      </div>
      {canSelect ? (
        <Button
          type="button"
          variant={isSelected ? "secondary" : "ghost"}
          className="mt-3 w-full sm:w-auto"
          onClick={onSelect}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {isSelected ? "Selected for final" : "Select for final"}
        </Button>
      ) : null}
      {showDetails && candidate.participantDetails?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidate.participantDetails.map((detail) => (
            <span
              key={detail.membershipId}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium",
                detail.reluctantCount > 0
                  ? "border-amber-200 bg-amber-50 text-amber-950"
                  : "border-teal-200 bg-teal-50 text-teal-950",
              )}
            >
              {detail.displayName ?? "Unnamed participant"}
              {detail.reluctantCount > 0 ? ` (${detail.reluctantCount} if needed)` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function FinalSlotBanner({
  slot,
  fallbackTimeZone,
  canReopen,
  isSubmitting,
  onReopen,
}: {
  slot: FinalSlot;
  fallbackTimeZone: string;
  canReopen: boolean;
  isSubmitting: boolean;
  onReopen: () => void;
}) {
  const timeZone = slot.timeZone ?? fallbackTimeZone;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Final time</Badge>
            <span className="text-xs font-medium text-slate-500">{timeZone}</span>
          </div>
          <p className="break-words text-lg font-semibold text-foreground">
            {formatSlotWindow(slot, timeZone)}
          </p>
        </div>
        {canReopen ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={isSubmitting}
            onClick={onReopen}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Reopen responses
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FinalConfirmation({
  candidate,
  timeZone,
  durationMinutes,
}: {
  candidate: ScoredCandidateSlot;
  timeZone: string;
  durationMinutes: number;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
      <p className="font-medium text-foreground">
        Confirm {formatCandidateWindow(candidate, timeZone)}
      </p>
      <p className="mt-1 leading-6 text-slate-600">
        {durationMinutes} minutes in {timeZone}. {candidate.availableParticipantCount} of{" "}
        {candidate.totalParticipantCount} can attend
        {candidate.reluctantVoteCount > 0
          ? `, with ${candidate.reluctantVoteCount} response ${candidate.reluctantVoteCount === 1 ? "cell" : "cells"} marking part of the time as “if needed”`
          : ""}
        .
      </p>
    </div>
  );
}

function HeatmapBar({
  candidate,
  timeZone,
}: {
  candidate: ScoredCandidateSlot;
  timeZone: string;
}) {
  const strengthClass =
    candidate.scorePercent >= 80
      ? "bg-teal-500"
      : candidate.scorePercent >= 50
        ? "bg-sky-500"
        : "bg-amber-400";

  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-foreground">
          {formatCandidateWindow(candidate, timeZone)}
        </span>
        <span className="shrink-0 text-slate-500">
          {candidate.availableParticipantCount}/{candidate.totalParticipantCount}
        </span>
      </div>
      <div className="h-2 rounded bg-slate-100" aria-hidden="true">
        <div
          className={cn("h-2 rounded", strengthClass)}
          style={{ width: `${Math.max(candidate.scorePercent, 4)}%` }}
        />
      </div>
      <span className="sr-only">{candidate.scorePercent}% match score</span>
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

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-slate-500">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {label}
      </dt>
      <dd className="text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function EmptyResultsMessage({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4 text-sm leading-6 text-slate-600">
      {message}
    </div>
  );
}

function formatCandidateWindow(candidate: ScoredCandidateSlot, timeZone: string) {
  return formatSlotWindow(candidate, timeZone);
}

function formatSlotWindow(slot: FinalSlot, timeZone: string) {
  const start = new Date(slot.startUtc);
  const end = new Date(slot.endUtc);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${date}, ${timeFormatter.format(start)}-${timeFormatter.format(end)}`;
}

function candidateKey(candidate: FinalSlot) {
  return `${candidate.startUtc}_${candidate.endUtc}`;
}

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
