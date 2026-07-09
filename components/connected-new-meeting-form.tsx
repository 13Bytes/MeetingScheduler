"use client";

import { NewMeetingForm } from "@/components/new-meeting-form";
import { getAnonymousClientRateLimitKey } from "@/lib/client-rate-limit-key";

export function ConnectedNewMeetingForm() {
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
