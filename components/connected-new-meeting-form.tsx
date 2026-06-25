"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { NewMeetingForm } from "@/components/new-meeting-form";

export function ConnectedNewMeetingForm() {
  const createMeeting = useMutation(api.meetings.createMeeting);

  return <NewMeetingForm createMeeting={(args) => createMeeting(args)} />;
}
