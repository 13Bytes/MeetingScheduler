import { ArrowRight, CodeXml, Link2, Mail } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  HomeAvailabilityBoard,
  ParticipantAvatars,
} from "@/components/home-availability-board";
import { routes } from "@/lib/routes";

const featureItems = [
  {
    icon: Link2,
    label: "No account required",
    text: "Create a meeting and collect responses without asking anyone to sign up.",
  },
  {
    icon: Mail,
    label: "Come back anytime",
    text: "Add your email to keep your meetings easy to find on any device.",
  },
  {
    icon: CodeXml,
    label: "Open Source",
    text: "The code is public. Read it, run your own copy, or help improve it.",
    link: {
      href: "https://github.com/13Bytes/MeetingScheduler",
      label: "View on GitHub",
    },
  },
];

const steps = [
  {
    title: "Create a poll",
    text: "Pick a duration and the days that are on the table.",
  },
  {
    title: "Share one link",
    text: "Everyone paints yes, if needed, or no. No accounts.",
  },
  {
    title: "Lock in the best time",
    text: "Results rank themselves live. Finalize in one click.",
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <section className="relative isolate -mx-4 grid items-center gap-10 px-4 pb-6 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:px-8 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 40% 55% at 78% 40%, rgba(37, 99, 235, 0.26), transparent), radial-gradient(ellipse 35% 45% at 45% 85%, rgba(20, 184, 166, 0.2), transparent)",
            maskImage:
              "radial-gradient(ellipse 50% 50% at 50% 50%, #000 45%, transparent 100%)",
          }}
        />
        <div>
          <h1 className="max-w-xl text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Find the time that works for{" "}
            <span className="bg-[linear-gradient(transparent_62%,rgba(20,184,166,0.35)_62%)]">
              everyone
            </span>
            .
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Create a poll, share one link, and watch the best time appear as people paint
            their availability.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              className="min-h-11 px-5 text-base shadow-[0_6px_16px_rgba(37,99,235,0.28)]"
            >
              <Link href={routes.newMeeting}>
                Create a meeting
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="min-h-11 px-5 text-base lg:hidden"
            >
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
            <ParticipantAvatars count={4} />
            No sign-up for you or your guests
          </div>
        </div>

        <HomeAvailabilityBoard />
      </section>

      <section id="how-it-works" className="scroll-mt-6 space-y-4">
        <h2 className="sr-only">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Card className="flex h-full items-start gap-4 p-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-100 font-bold text-primary">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{step.text}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {featureItems.map((item) => (
          <RoutePlaceholder
            key={item.label}
            icon={item.icon}
            title={item.label}
            description={item.text}
            link={item.link}
          />
        ))}
      </section>
    </AppShell>
  );
}
