import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import {
  IdentityMeetingsList,
  type IdentityMeetingsDashboard,
} from "@/components/identity-meetings-list";
import { IdentityLoginPanel } from "@/components/identity-login-panel";
import { UserMembershipImporter } from "@/components/user-membership-importer";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import { getIdentitySessionSecret } from "@/lib/identity-session";
import { safeErrorMessage } from "@/lib/security-redaction";
import { userSessionCookieName, verifyUserSession } from "@/lib/user-session";

export const dynamic = "force-dynamic";

export default async function IdentityDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const session = verifyUserSession(
    cookieStore.get(userSessionCookieName)?.value,
    getIdentitySessionSecret(),
  );
  const { error } = await searchParams;

  if (!session) {
    return (
      <AppShell>
        <UserMembershipImporter />
        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,420px)] lg:items-start">
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground">
              All Meetings
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Enter your email and we will send you a secure sign-in link.
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

  let dashboard: IdentityMeetingsDashboard | { error: string };
  try {
    dashboard = await loadIdentityDashboard(session.userId);
  } catch (caughtError) {
    console.error(
      "Unable to load identity dashboard",
      safeErrorMessage(caughtError, "dashboard load failed"),
    );
    dashboard = {
      error: "Unable to load your meetings right now.",
    };
  }

  return (
    <AppShell>
      <UserMembershipImporter />
      <section className="space-y-3">
        <Badge variant="accent">Your meetings</Badge>
        <h1 className="text-3xl font-semibold tracking-normal text-foreground">
          All Meetings
        </h1>
        {"error" in dashboard ? (
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            Meetings you create or join will appear here.
          </p>
        ) : (
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            Open a meeting to update your availability, invite others, or manage its
            details.
          </p>
        )}
      </section>

      {"error" in dashboard ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          {dashboard.error}
        </div>
      ) : (
        <IdentityMeetingsList
          dashboard={dashboard}
          emptyMessage="You have not created or joined any meetings yet."
        />
      )}
    </AppShell>
  );
}

async function loadIdentityDashboard(userId: string): Promise<IdentityMeetingsDashboard> {
  const convex = new ConvexHttpClient(getConvexUrl());
  return await convex.query(api.meetings.listUserDashboard, {
    internalSecret: getInternalIdentitySecret(),
    userId: userId as Id<"users">,
  });
}
