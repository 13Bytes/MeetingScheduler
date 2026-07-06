"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { NewMeetingForm } from "@/components/new-meeting-form";
import { getAnonymousClientRateLimitKey } from "@/lib/client-rate-limit-key";

export function ConnectedNewMeetingForm() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <NewMeetingForm />;
  }

  return <LiveNewMeetingForm />;
}

function LiveNewMeetingForm() {
  const createMeeting = useMutation(api.meetings.createMeeting);

  return (
    <NewMeetingForm
      createMeeting={(args) =>
        createMeeting({
          ...args,
          clientRateLimitKey: getAnonymousClientRateLimitKey(),
        })
      }
    />
  );
}
