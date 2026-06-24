import { cn } from "@/lib/utils";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const times = ["9:00", "10:00", "11:00", "12:00", "13:00"];

const selectedCells = new Set(["Mon-10:00", "Mon-11:00", "Wed-9:00", "Thu-13:00"]);
const tentativeCells = new Set(["Tue-12:00", "Wed-10:00", "Fri-11:00"]);

export function CalendarGridPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-[72px_repeat(5,minmax(72px,1fr))] bg-surface-muted text-xs font-medium text-slate-600">
        <div className="border-r border-border px-3 py-2">Time</div>
        {days.map((day) => (
          <div key={day} className="border-r border-border px-3 py-2 last:border-r-0">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[72px_repeat(5,minmax(72px,1fr))]">
        {times.map((time) => (
          <Row key={time} time={time} />
        ))}
      </div>
    </div>
  );
}

function Row({ time }: { time: string }) {
  return (
    <>
      <div className="border-r border-t border-border bg-surface-muted px-3 py-4 text-xs font-medium text-slate-500">
        {time}
      </div>
      {days.map((day) => {
        const key = `${day}-${time}`;
        const isSelected = selectedCells.has(key);
        const isTentative = tentativeCells.has(key);

        return (
          <div
            key={key}
            className={cn(
              "min-h-14 border-r border-t border-border last:border-r-0",
              isSelected && "bg-primary",
              isTentative && "bg-teal-100",
              !isSelected && !isTentative && "bg-surface",
            )}
          >
            <span className="sr-only">
              {day} at {time}
            </span>
          </div>
        );
      })}
    </>
  );
}
