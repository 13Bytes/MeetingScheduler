import Link from "next/link";
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
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Link
            href="/"
            className="w-fit text-lg font-semibold tracking-normal text-foreground"
          >
            Meeting Scheduler
          </Link>
          <nav
            className="-mx-1 flex w-full min-w-0 gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 lg:w-auto"
            aria-label="Primary"
          >
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
