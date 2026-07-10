"use client";

import { Eraser, MousePointer2, Paintbrush } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import type {
  CalendarGrid,
  CalendarGridCell,
  PaintMode,
} from "@/lib/admin-calendar-painter";
import { cn } from "@/lib/utils";

export function CalendarPaintGrid({
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
  ariaLabel = "Allowed time calendar",
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
  ariaLabel?: string;
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
        aria-label={ariaLabel}
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
    mode === "block" ? "bg-rose-200" : mode === "preview" ? "bg-sky-200" : "bg-blue-200";
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
        isAllowed ? "bg-blue-500 hover:bg-blue-600" : "bg-surface hover:bg-blue-50",
        cell.isWeekend && !isAllowed && "bg-slate-50",
        isPreview && previewClass,
      )}
      onPointerDown={(event) => {
        if (disabled) return;
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
        if (disabled || event.buttons !== 1) return;
        const touchStart = touchStartRef.current;
        if (event.pointerType === "touch" && touchStart) {
          const deltaX = Math.abs(event.clientX - touchStart.x);
          const deltaY = Math.abs(event.clientY - touchStart.y);
          touchStart.moved = touchStart.moved || deltaX > 10 || deltaY > 10;
          return;
        }
        const targetCellKey = getPointerTargetCellKey(event);
        if (targetCellKey && targetCellKey !== cell.key) onHover(targetCellKey);
      }}
      onPointerEnter={(event) => {
        if (!disabled && event.buttons === 1) onHover(cell.key);
      }}
      onPointerUp={() => {
        if (disabled) return;
        const touchStart = touchStartRef.current;
        if (touchStart) {
          if (!touchStart.moved) onApplyCell(cell.key);
          touchStartRef.current = null;
          return;
        }
        onCommit();
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
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

export function BrushControls({
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
