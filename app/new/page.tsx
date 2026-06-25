import { AppShell } from "@/components/app-shell";
import { ConnectedNewMeetingForm } from "@/components/connected-new-meeting-form";

export const dynamic = "force-dynamic";

export default function NewMeetingPage() {
  return (
    <AppShell>
      <ConnectedNewMeetingForm />
    </AppShell>
  );
}
