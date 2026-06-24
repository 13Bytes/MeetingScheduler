import Link from "next/link";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/new", label: "New meeting" },
  { href: "/m/demo-poll", label: "Poll" },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-surface/90">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Link
            href="/"
            className="text-lg font-semibold tracking-normal text-foreground"
          >
            Meeting Scheduler
          </Link>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Primary">
            {navItems.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}
