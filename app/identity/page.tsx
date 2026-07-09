import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import {
  IdentityMeetingsList,
  type IdentityMeetingsDashboard,
} from "@/components/identity-meetings-list";
import { IdentityLoginPanel } from "@/components/identity-login-panel";
import { UserMembershipImporter } from "@/components/user-membership-importer";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import { safeErrorMessage } from "@/lib/security-redaction";
import {
  userSessionCookieName,
  verifyUserSession,
} from "@/lib/user-session";
import { getIdentitySessionSecret } from "@/lib/identity-session";

export const dynamic = "force-dynamic";

export default async function IdentityPage() {
  const cookieStore = await cookies();
  const session = verifyUserSession(
    cookieStore.get(userSessionCookieName)?.value,
    getIdentitySessionSecret(),
  );
  const dashboard = session ? await loadDashboard(session.userId) : null;

  return (
    <AppShell>
      <UserMembershipImporter />
      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,420px)] lg:items-start">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            All Meetings
          </h1>
          {dashboard && !("error" in dashboard) ? (
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Meetings are tied to this browser session. Verify an email to recover this
              same list from another browser later.
            </p>
          ) : (
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Create, join, or open a private return link to add meetings here. Verify an
              email to recover this session later.
            </p>
          )}
          {!session ? (
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="secondary" className="w-full sm:w-auto">
                <Link href="/new">Create without an account</Link>
              </Button>
            </div>
          ) : null}
        </div>
        <IdentityLoginPanel />
      </section>

      {dashboard ? (
        "error" in dashboard ? (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            {dashboard.error}
          </div>
        ) : (
          <IdentityMeetingsList dashboard={dashboard} />
        )
      ) : null}
    </AppShell>
  );
}

async function loadDashboard(
  userId: string,
): Promise<IdentityMeetingsDashboard | { error: string }> {
  try {
    const convex = new ConvexHttpClient(getConvexUrl());
    return await convex.query(api.meetings.listUserDashboard, {
      internalSecret: getInternalIdentitySecret(),
      userId: userId as Id<"users">,
    });
  } catch (caughtError) {
    console.error(
      "Unable to load identity meetings",
      safeErrorMessage(caughtError, "meeting list load failed"),
    );
    return { error: "Unable to load meetings for this browser session." };
  }
}
