"use client";

import Link from "next/link";
import { ArrowRight, Check, Clipboard, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCreatedMeetingLinks, routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type LinkKind = "participant" | "organizer";

export function CreatedMeetingHandoff({
  meetingSlug,
  adminMembershipToken,
}: {
  meetingSlug: string;
  adminMembershipToken: string;
}) {
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const [copiedLink, setCopiedLink] = useState<LinkKind | null>(null);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (!copiedLink) {
      return;
    }
    const resetCopiedState = window.setTimeout(() => setCopiedLink(null), 2500);
    return () => window.clearTimeout(resetCopiedState);
  }, [copiedLink]);

  const links = origin
    ? buildCreatedMeetingLinks({ origin, meetingSlug, adminMembershipToken })
    : null;

  async function copyLink(kind: LinkKind, value: string | undefined) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLink(kind);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
          Your meeting is ready
        </h1>
        <p className="text-sm leading-6 text-slate-600">
          You can also access the links later.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-5 text-primary" aria-hidden="true" />
            Meeting links
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <CopyLinkField
            label="Participant invitation"
            description="Share this link with everyone who should submit availability."
            value={links?.publicParticipantUrl ?? ""}
            copied={copiedLink === "participant"}
            onCopy={() => copyLink("participant", links?.publicParticipantUrl)}
          />
          <CopyLinkField
            label="Your private organizer link"
            description="Keep this private. It gives access to your response and organizer tools."
            value={links?.adminMembershipUrl ?? ""}
            copied={copiedLink === "organizer"}
            onCopy={() => copyLink("organizer", links?.adminMembershipUrl)}
            sensitive
          />

          {copyError ? (
            <p className="text-sm text-amber-800" role="alert">
              Clipboard access is unavailable. Select the link text to copy it.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild className="w-full sm:w-auto">
          <Link href={routes.membershipLink(adminMembershipToken)}>
            Continue to meeting
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function subscribeToOrigin() {
  return () => undefined;
}

function getBrowserOrigin() {
  return window.location.origin;
}

function getServerOrigin() {
  return "";
}

function CopyLinkField({
  label,
  description,
  value,
  copied,
  onCopy,
  sensitive = false,
}: {
  label: string;
  description: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  sensitive?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 rounded-md border border-border p-4",
        sensitive && "border-amber-200 bg-amber-50",
      )}
    >
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
      </div>
      <div className="flex min-w-0 gap-2">
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          aria-label={label}
          value={value}
          placeholder="Preparing link..."
          readOnly
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="shrink-0"
          aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
          disabled={!value}
          onClick={onCopy}
        >
          {copied ? (
            <Check className="size-4 text-accent" aria-hidden="true" />
          ) : (
            <Clipboard className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
