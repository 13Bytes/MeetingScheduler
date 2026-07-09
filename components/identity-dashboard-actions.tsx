"use client";

import { useState } from "react";
import { Check, Clipboard, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RecoverMembershipLinkButton({ membershipId }: { membershipId: string }) {
  const [membershipUrl, setMembershipUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function recoverLink() {
    setIsBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/identity/recover-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      });
      const body = (await response.json()) as {
        error?: string;
        membershipUrl?: string;
      };
      if (!response.ok || !body.membershipUrl) {
        throw new Error(body.error ?? "Unable to recover a membership link.");
      }
      setMembershipUrl(body.membershipUrl);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to recover a membership link.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function copyLink() {
    if (!membershipUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(membershipUrl);
      setCopied(true);
    } catch {
      setError("Clipboard access is unavailable. Select the link text to copy it.");
    }
  }

  return (
    <div className="grid gap-2">
      {membershipUrl ? (
        <div className="flex min-w-0 gap-2">
          <input
            className={`${inputClassName} min-w-0`}
            readOnly
            value={membershipUrl}
            aria-label="Recovered membership link"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="shrink-0"
            aria-label="Copy recovered membership link"
            onClick={copyLink}
          >
            {copied ? (
              <Check className="size-4 text-accent" aria-hidden="true" />
            ) : (
              <Clipboard className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" disabled={isBusy} onClick={recoverLink}>
          {isBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-4" aria-hidden="true" />
          )}
          Recover private link
        </Button>
      )}
      {error ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
