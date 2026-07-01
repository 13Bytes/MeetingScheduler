import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { IdentityLoginPanel } from "@/components/identity-login-panel";
import { Button } from "@/components/ui/button";

export default function IdentityPage() {
  return (
    <AppShell>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_420px] lg:items-start">
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            Email recovery
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">
            Passwordless email is optional. It helps you recover meetings and submitted
            responses after you attach a verified email to a membership.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/identity/dashboard">Open dashboard</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/new">Create without an account</Link>
            </Button>
          </div>
        </div>
        <IdentityLoginPanel />
      </section>
    </AppShell>
  );
}
