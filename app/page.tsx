import { CalendarDays, Link2, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarGridPreview } from "@/components/ui/calendar-grid-preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { routes } from "@/lib/routes";

const foundationItems = [
  {
    icon: CalendarDays,
    label: "Calendar-heavy UI primitives",
    text: "Responsive surfaces, buttons, badges, and a reusable calendar grid preview.",
  },
  {
    icon: Link2,
    label: "Secret-link route map",
    text: "Placeholders for public polls, membership links, and organizer links.",
  },
  {
    icon: Mail,
    label: "Email identity ready",
    text: "Environment documentation leaves room for later passwordless identity flows.",
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <section className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:items-start">
        <div className="space-y-6">
          <Badge variant="accent">Stage 2 creation flow</Badge>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
              Meeting Scheduler
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              Create a Doodle-style poll without an account, then share a public
              participant link and keep your personal admin membership link.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={routes.newMeeting}>Create a meeting</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={routes.meetingPoll("demo-poll")}>View poll placeholder</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              Calendar Surface
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CalendarGridPreview />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {foundationItems.map((item) => (
          <RoutePlaceholder
            key={item.label}
            icon={item.icon}
            title={item.label}
            description={item.text}
          />
        ))}
      </section>
    </AppShell>
  );
}
