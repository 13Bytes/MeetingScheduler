"use client";

import {
  CalendarCheck2,
  CheckCircle2,
  EyeOff,
  Loader2,
  RotateCcw,
  SmilePlus,
  UsersRound,
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
  const hasCandidates = results.candidateCount > 0;
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const defaultCandidate = results.shortlist[0] ?? results.candidates[0];
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
      setStatus({ tone: "success", message: "Poll reopened for edits." });
    } catch (caughtError) {
      setStatus({
        tone: "error",
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Reopening the poll failed.",
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck2 className="size-5 text-primary" aria-hidden="true" />
                  Recommended Shortlist
                </CardTitle>
                <p className="text-sm leading-6 text-slate-600">
                  Ranked by attendees first, then fewer reluctant cells, then earliest
                  start.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canAdminister ? <Badge variant="accent">Admin view</Badge> : null}
                {!results.detailsVisible ? (
                  <Badge>
                    <EyeOff className="size-3.5" aria-hidden="true" />
                    Summary only
                  </Badge>
                ) : (
                  <Badge>Detailed</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {!hasParticipants ? (
              <EmptyResultsMessage message="No participants have joined yet. Recommendations will update as people save responses." />
            ) : null}
            {hasParticipants && !hasCandidates ? (
              <EmptyResultsMessage message="No candidate slots fit inside the current admin-allowed ranges." />
            ) : null}
            {results.shortlist.map((candidate) => (
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

        <aside className="space-y-4">
          {canAdminister &&
          (canFinalize || canReopen || lifecycleState === "finalized") ? (
            <Card>
              <CardHeader>
                <CardTitle>Final Selection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {lifecycleState === "finalized" ? (
                  <p className="text-sm leading-6 text-slate-600">
                    This poll is finalized. Results remain visible, and editing stays
                    locked until an admin reopens it.
                  </p>
                ) : hasCandidates ? (
                  <>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-foreground">
                        Override candidate
                      </span>
                      <select
                        className={inputClassName}
                        value={activeCandidateKey ?? ""}
                        onChange={(event) => setSelectedCandidateKey(event.target.value)}
                        disabled={!canFinalize || isSubmitting}
                        aria-label="Override final slot"
                      >
                        {results.candidates.map((candidate) => (
                          <option
                            key={candidateKey(candidate)}
                            value={candidateKey(candidate)}
                          >
                            #{candidate.rank}{" "}
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
                    Add admin-allowed ranges before finalizing a meeting time.
                  </p>
                )}
                {status ? (
                  <StatusMessage tone={status.tone}>{status.message}</StatusMessage>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Score Heatmap</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {results.candidates.slice(0, 12).map((candidate) => (
                <HeatmapBar
                  key={`${candidate.startUtc}_${candidate.endUtc}`}
                  candidate={candidate}
                  timeZone={results.timeZone}
                />
              ))}
              {results.candidates.length > 12 ? (
                <p className="text-xs leading-5 text-slate-500">
                  Showing the strongest 12 of {results.candidates.length} candidate slots.
                </p>
              ) : null}
              {hasParticipants && hasCandidates ? null : (
                <p className="text-sm leading-6 text-slate-600">
                  The heatmap appears once there are participants and valid candidate
                  slots.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
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
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              #{candidate.rank} {formatCandidateWindow(candidate, timeZone)}
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
            label="Reluctant"
            value={candidate.reluctantVoteCount}
          />
          <Metric label="Score" value={`${candidate.scorePercent}%`} />
        </div>
      </div>
      {canSelect ? (
        <Button
          type="button"
          variant={isSelected ? "secondary" : "ghost"}
          className="mt-3"
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
              {detail.reluctantCount > 0 ? ` (${detail.reluctantCount} reluctant)` : ""}
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
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Final time</Badge>
            <span className="text-xs font-medium text-slate-500">{timeZone}</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            {formatSlotWindow(slot, timeZone)}
          </p>
        </div>
        {canReopen ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={onReopen}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Reopen poll
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
        {durationMinutes} minutes in {timeZone}. Rank #{candidate.rank};{" "}
        {candidate.availableParticipantCount} of {candidate.totalParticipantCount} can
        attend, with {candidate.reluctantVoteCount} reluctant cell
        {candidate.reluctantVoteCount === 1 ? "" : "s"}.
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
      <div className="flex items-center justify-between gap-3 text-xs">
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
