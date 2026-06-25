import { AppShell } from "@/components/app-shell";
import { ConnectedNewMeetingForm } from "@/components/connected-new-meeting-form";
import { NewMeetingForm } from "@/components/new-meeting-form";

export default function NewMeetingPage() {
  const isConvexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <AppShell>
      {isConvexConfigured ? <ConnectedNewMeetingForm /> : <NewMeetingForm />}
    </AppShell>
  );
}
