import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default async function MeetingAdminPage({
  params,
}: {
  params: Promise<{ meetingSlug: string; adminToken: string }>;
}) {
  const { meetingSlug } = await params;

  return (
    <AppShell>
      <RoutePlaceholder
        icon={ShieldCheck}
        eyebrow="Organizer route"
        title="Organizer controls"
        description={`Admin placeholder for ${meetingSlug}. Later stages will gate this route through Convex-backed secret links without exposing bearer tokens in the UI.`}
      />
    </AppShell>
  );
}
