"use client";

import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { NewMeetingForm } from "@/components/new-meeting-form";
import { getAnonymousClientRateLimitKey } from "@/lib/client-rate-limit-key";

const subscribeNoop = () => () => {};

/**
 * The form's defaults (timezone, custom date range, preset windows) come from the
 * browser's timezone and clock, which the server can't know. Rendering it only on the
 * client avoids a hydration mismatch for anyone not in the server's timezone.
 */
function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

export function ConnectedNewMeetingForm() {
  const isClient = useIsClient();

  if (!isClient) {
    return (
      <div className="space-y-2" aria-busy="true">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
          Create a meeting
        </h1>
        <p className="flex items-center gap-2 text-sm leading-6 text-slate-600">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading meeting options…
        </p>
      </div>
    );
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <NewMeetingForm />;
  }

  return <LiveNewMeetingForm />;
}

function LiveNewMeetingForm() {
  return (
    <NewMeetingForm
      createMeeting={async (args) => {
        const response = await fetch("/api/user/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...args,
            clientRateLimitKey: getAnonymousClientRateLimitKey(),
          }),
        });
        const body = await parseCreateMeetingResponse(response);
        if (!response.ok) {
          throw new Error(body?.error ?? "Meeting creation failed.");
        }
        if (!body?.slug || !body.adminMembershipToken) {
          throw new Error(body?.error ?? "Meeting creation failed.");
        }
        return {
          slug: body.slug,
          adminMembershipToken: body.adminMembershipToken,
        };
      }}
    />
  );
}

async function parseCreateMeetingResponse(response: Response): Promise<{
  error?: string;
  slug?: string;
  adminMembershipToken?: string;
} | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    return (await response.json()) as {
      error?: string;
      slug?: string;
      adminMembershipToken?: string;
    };
  } catch {
    return null;
  }
}
