import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md text-center text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary px-4 text-primary-foreground hover:bg-blue-700",
        secondary:
          "border border-border bg-surface px-4 text-foreground hover:bg-surface-muted",
        ghost: "px-3 text-slate-600 hover:bg-surface-muted hover:text-foreground",
      },
      size: {
        default: "py-2",
        sm: "min-h-9 py-1.5 text-sm",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild ? { type: type ?? "button" } : type ? { type } : {})}
      {...props}
    />
  );
}
