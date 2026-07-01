"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type IdentitySessionState =
  | { signedIn: false }
  | {
      signedIn: true;
      normalizedEmail: string;
      expiresAt: number;
    };

export function MembershipIdentityPanel({
  membershipToken,
  attachedEmailIdentityId,
}: {
  membershipToken?: string;
  attachedEmailIdentityId?: string;
}) {
  const [session, setSession] = useState<IdentitySessionState | null>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [devMagicLinkUrl, setDevMagicLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isAttached, setIsAttached] = useState(Boolean(attachedEmailIdentityId));

  useEffect(() => {
    let isMounted = true;
    fetch("/api/identity/session")
      .then((response) => response.json())
      .then((body: IdentitySessionState) => {
        if (isMounted) {
          setSession(body);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSession({ signedIn: false });
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function requestVerification() {
    setIsBusy(true);
    setError(null);
    setStatus(null);
    setDevMagicLinkUrl(null);
    try {
      const response = await fetch("/api/identity/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json()) as {
        error?: string;
        tokenFingerprint?: string;
        devMagicLinkUrl?: string;
      };
      if (!response.ok || !body.tokenFingerprint) {
        throw new Error(body.error ?? "Unable to request verification.");
      }
      setStatus(`Verification link queued. Fingerprint ${body.tokenFingerprint}.`);
      setDevMagicLinkUrl(body.devMagicLinkUrl ?? null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to request verification.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function attachMembership() {
    if (!membershipToken) {
      return;
    }
    setIsBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/identity/attach-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipToken }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to attach this membership.");
      }
      setIsAttached(true);
      setStatus("This membership is now recoverable from your verified email.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to attach this membership.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          Optional Email Recovery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {session?.signedIn ? (
          <>
            <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
              <span className="text-slate-500">Verified email </span>
              <span className="font-medium text-foreground">
                {session.normalizedEmail}
              </span>
            </div>
            {isAttached ? (
              <p className="flex items-center gap-2 text-sm text-teal-700">
                <Check className="size-4" aria-hidden="true" />
                This membership has email recovery attached.
              </p>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={!membershipToken || isBusy}
                onClick={attachMembership}
              >
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Attach to this membership
              </Button>
            )}
            <Button asChild variant="ghost" className="w-full">
              <Link href="/identity/dashboard">Open recovery dashboard</Link>
            </Button>
          </>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm leading-6 text-slate-600">
              Add a verified email later if you want account-like recovery. Your private
              membership link still works on its own.
            </p>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Email</span>
              <input
                className={inputClassName}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ada@example.com"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={!email || isBusy}
              onClick={requestVerification}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mail className="size-4" aria-hidden="true" />
              )}
              Send verification link
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/identity">Email recovery page</Link>
            </Button>
          </div>
        )}
        {status ? (
          <div
            className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950"
            role="status"
          >
            {status}
            {devMagicLinkUrl ? (
              <a className="mt-2 block font-medium underline" href={devMagicLinkUrl}>
                Open local development magic link
              </a>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
