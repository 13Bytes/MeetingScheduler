import Link from "next/link";
import { Menu } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

const navItems = [
  { href: routes.home, label: "Overview" },
  { href: routes.newMeeting, label: "New meeting" },
  { href: routes.identity, label: "All Meetings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-surface/90">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
          <Link
            href="/"
            className="w-fit text-lg font-semibold tracking-normal text-foreground"
          >
            Meeting Scheduler
          </Link>

          <details className="group relative sm:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-surface text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Menu className="size-5" aria-hidden="true" />
              <span className="sr-only">Open navigation menu</span>
            </summary>
            <nav
              className="absolute right-0 z-30 mt-2 grid min-w-52 gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg"
              aria-label="Mobile primary"
            >
              {navItems.map((item) => (
                <Button
                  key={item.href}
                  asChild
                  variant="ghost"
                  className="w-full justify-start"
                >
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </nav>
          </details>

          <nav className="hidden min-w-0 gap-2 sm:flex sm:flex-wrap" aria-label="Primary">
            {navItems.map((item) => (
              <Button
                key={item.href}
                asChild
                variant="ghost"
                size="sm"
                className="shrink-0"
              >
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </div>
    </main>
  );
}
