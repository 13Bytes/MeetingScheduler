"use client";

import { CalendarCheck2, EyeOff, SmilePlus, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MeetingResults, ScoredCandidateSlot } from "@/lib/meeting-results";
import { cn } from "@/lib/utils";

export function MeetingResultsPanel({
  results,
  canAdminister = false,
}: {
  results: MeetingResults;
  canAdminister?: boolean;
}) {
  const hasParticipants = results.totalParticipantCount > 0;
  const hasCandidates = results.candidateCount > 0;

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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
            />
          ))}
        </CardContent>
      </Card>

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
              The heatmap appears once there are participants and valid candidate slots.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CandidateRow({
  candidate,
  timeZone,
  showDetails,
}: {
  candidate: ScoredCandidateSlot;
  timeZone: string;
  showDetails: boolean;
}) {
  return (
    <article className="rounded-md border border-border bg-surface-muted p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">
            #{candidate.rank} {formatCandidateWindow(candidate, timeZone)}
          </h3>
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
  const start = new Date(candidate.startUtc);
  const end = new Date(candidate.endUtc);
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
