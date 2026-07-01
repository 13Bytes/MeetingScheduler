import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RecoverMembershipLinkButton } from "@/components/identity-dashboard-actions";
import { IdentityLoginPanel } from "@/components/identity-login-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  getIdentitySessionSecret,
  identitySessionCookieName,
  verifyEmailIdentitySession,
} from "@/lib/identity-session";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function IdentityDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const session = verifyEmailIdentitySession(
    cookieStore.get(identitySessionCookieName)?.value,
    getIdentitySessionSecret(),
  );
  const { error } = await searchParams;

  if (!session) {
    return (
      <AppShell>
        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_420px] lg:items-start">
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground">
              Recovery dashboard
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Verify your email to see attached memberships and recover private links.
            </p>
            {error ? (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                role="alert"
              >
                That verification link is missing, expired, or already used.
              </div>
            ) : null}
          </div>
          <IdentityLoginPanel />
        </section>
      </AppShell>
    );
  }

  let dashboard: Awaited<ReturnType<typeof loadIdentityDashboard>> | { error: string } = {
    error: "",
  };
  try {
    dashboard = await loadIdentityDashboard(session.emailIdentityId);
  } catch (caughtError) {
    dashboard = {
      error:
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load the recovery dashboard.",
    };
  }

  return (
    <AppShell>
      <section className="space-y-3">
        <Badge variant="accent">Verified email</Badge>
        <h1 className="text-3xl font-semibold tracking-normal text-foreground">
          Recovery dashboard
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Signed in as {session.normalizedEmail}. Only memberships already attached to
          this verified email appear here.
        </p>
      </section>

      {"error" in dashboard ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          {dashboard.error}
        </div>
      ) : dashboard.memberships.length === 0 ? (
        <Card>
          <CardContent className="grid min-h-48 place-items-center pt-5 text-center text-sm leading-6 text-slate-600">
            No recoverable memberships are attached to this email yet.
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {dashboard.memberships.map((membership) => (
            <Card key={membership.membershipId}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="size-5 text-primary" aria-hidden="true" />
                  {membership.meeting.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge>{membership.role === "admin" ? "Admin" : "Participant"}</Badge>
                  {membership.hasAvailability ? <Badge>Response saved</Badge> : null}
                  <Badge>{membership.meeting.lifecycleState}</Badge>
                </div>
                {membership.displayName ? (
                  <p className="text-sm leading-6 text-slate-600">
                    Membership name: {membership.displayName}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="ghost">
                    <Link href={routes.meetingPoll(membership.meeting.slug)}>
                      Public poll
                    </Link>
                  </Button>
                </div>
                <RecoverMembershipLinkButton membershipId={membership.membershipId} />
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </AppShell>
  );
}

async function loadIdentityDashboard(emailIdentityId: string) {
  const convex = new ConvexHttpClient(getConvexUrl());
  return await convex.query(api.meetings.listIdentityDashboard, {
    internalSecret: getInternalIdentitySecret(),
    emailIdentityId: emailIdentityId as Id<"emailIdentities">,
  });
}
