"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const times = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

export const sampleParticipants = [
  { initials: "AL", className: "bg-blue-600" },
  { initials: "BK", className: "bg-teal-600" },
  { initials: "CM", className: "bg-amber-500" },
  { initials: "DS", className: "bg-rose-600" },
  { initials: "EF", className: "bg-violet-600" },
];

/** How many of the five sample participants are free in each cell, row by row. */
const finalCounts = [
  [2, 3, 1, 3, 2],
  [3, 2, 5, 3, 1],
  [2, 4, 3, 2, 1],
  [1, 2, 2, 3, 2],
  [3, 4, 2, 4, 1],
  [2, 1, 1, 2, 0],
];
const best = { row: 1, column: 2 };
const participantCount = sampleParticipants.length;
/** Responses arrive one per tick, then the finished board holds for a couple of ticks. */
const animationSteps = participantCount + 3;
const tickMs = 900;
const startDelayMs = 300;

export function HomeAvailabilityBoard() {
  // Start (and server-render) the finished board; the loop only runs after mount.
  const [step, setStep] = useState(participantCount);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let intervalId: number | undefined;
    // Kick off the first cycle right after mount instead of waiting out the hold.
    const startId = window.setTimeout(() => {
      setStep(0);
      intervalId = window.setInterval(() => {
        setStep((current) => (current + 1) % animationSteps);
      }, tickMs);
    }, startDelayMs);
    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  const responded = Math.min(step, participantCount);
  const isComplete = responded === participantCount;

  return (
    <Card
      className="relative p-4 pb-8 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.25)] sm:p-6"
      role="img"
      aria-label="Example meeting: five people mark their availability and Wednesday at 10:00 works for all of them."
    >
      <div className="mb-4 flex items-center justify-between gap-3" aria-hidden="true">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Team retro</p>
          <p className="text-xs text-slate-500">60 min · Europe/Berlin</p>
        </div>
        <ParticipantAvatars count={responded} />
      </div>

      <div
        className="grid grid-cols-[2.75rem_repeat(5,minmax(0,1fr))] gap-1 sm:grid-cols-[3.5rem_repeat(5,minmax(0,1fr))] sm:gap-1.5"
        aria-hidden="true"
      >
        <span />
        {days.map((day) => (
          <span
            key={day}
            className="pb-1 text-center text-xs font-semibold text-slate-500"
          >
            {day}
          </span>
        ))}
        {times.map((time, row) => (
          <BoardRow
            key={time}
            time={time}
            row={row}
            responded={responded}
            isComplete={isComplete}
          />
        ))}
      </div>

      <div
        className={cn(
          "pointer-events-none absolute -bottom-4 right-3 flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground shadow-[0_12px_24px_rgba(15,118,110,0.35)] transition-all duration-500 sm:-right-4",
          isComplete ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
        aria-hidden="true"
      >
        <Check className="size-4" aria-hidden="true" />
        Best: Wed 10:00 · {participantCount} of {participantCount} can make it
      </div>
    </Card>
  );
}

function BoardRow({
  time,
  row,
  responded,
  isComplete,
}: {
  time: string;
  row: number;
  responded: number;
  isComplete: boolean;
}) {
  return (
    <>
      <span className="flex items-center text-[11px] text-slate-400 sm:text-xs">
        {time}
      </span>
      {days.map((day, column) => {
        const count = Math.round(
          (finalCounts[row][column] * responded) / participantCount,
        );
        const isBest = isComplete && row === best.row && column === best.column;
        return (
          <span
            key={day}
            className={cn(
              "h-8 rounded-md transition-[background-color,box-shadow] duration-500 sm:h-9",
              isBest && "shadow-[0_0_0_2px_var(--surface),0_0_0_4.5px_var(--accent)]",
            )}
            style={{
              backgroundColor:
                count === 0
                  ? "var(--surface-muted)"
                  : `rgba(37, 99, 235, ${0.12 + count * 0.17})`,
            }}
          />
        );
      })}
    </>
  );
}

export function ParticipantAvatars({
  count = participantCount,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex h-8 shrink-0", className)}>
      {sampleParticipants.slice(0, count).map((participant, index) => (
        <span
          key={participant.initials}
          className={cn(
            "grid size-8 place-items-center rounded-full border-2 border-surface text-[11px] font-bold text-white",
            index > 0 && "-ml-2",
            participant.className,
          )}
        >
          {participant.initials}
        </span>
      ))}
    </div>
  );
}
