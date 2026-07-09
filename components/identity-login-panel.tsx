"use client";

import { FormEvent, useState } from "react";
import { Check, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function IdentityLoginPanel() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    tokenFingerprint: string;
    devMagicLinkUrl?: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/identity/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        tokenFingerprint?: string;
        devMagicLinkUrl?: string;
      };
      if (!response.ok || !body.tokenFingerprint) {
        throw new Error(body.error ?? "Unable to request a verification link.");
      }
      setResult({
        tokenFingerprint: body.tokenFingerprint,
        devMagicLinkUrl: body.devMagicLinkUrl,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to request a verification link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-5 text-primary" aria-hidden="true" />
          Email Recovery
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <p className="text-sm leading-6 text-slate-600">
            Verify an email to recover meetings and response links later. Meeting creation
            and joining still work without this.
          </p>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input
              className={inputClassName}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ada@example.com"
              required
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">
              Display name <span className="font-normal text-slate-500">optional</span>
            </span>
            <input
              className={inputClassName}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ada Lovelace"
            />
          </label>
          {error ? (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {result ? (
            <div
              className="grid gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950"
              role="status"
            >
              <span className="flex items-center gap-2 font-medium">
                <Check className="size-4" aria-hidden="true" />
                Verification link queued
              </span>
              <span className="break-all">Fingerprint {result.tokenFingerprint}</span>
              {result.devMagicLinkUrl ? (
                <a
                  className="break-all font-medium text-teal-950 underline"
                  href={result.devMagicLinkUrl}
                >
                  Open local development magic link
                </a>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="size-4" aria-hidden="true" />
            )}
            Send verification link
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
