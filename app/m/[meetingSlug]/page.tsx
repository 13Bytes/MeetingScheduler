import { UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default async function MeetingPollPage({
  params,
}: {
  params: Promise<{ meetingSlug: string }>;
}) {
  const { meetingSlug } = await params;

  return (
    <AppShell>
      <RoutePlaceholder
        icon={UsersRound}
        eyebrow="Public poll route"
        title="Meeting poll"
        description={`Meeting slug placeholder: ${meetingSlug}. Availability painting, realtime collaboration, and poll state will be implemented after Stage 0.`}
      />
    </AppShell>
  );
}
