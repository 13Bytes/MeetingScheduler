import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 space-y-3 p-4 sm:p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "min-w-0 text-lg font-semibold tracking-normal text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-w-0 px-4 pb-4 sm:px-5 sm:pb-5", className)} {...props} />
  );
}
