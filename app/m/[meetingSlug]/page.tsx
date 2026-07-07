import { UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConnectedPublicParticipantMeeting } from "@/components/participant-availability-painter";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default async function MeetingPollPage({
  params,
  searchParams,
}: {
  params: Promise<{ meetingSlug: string }>;
  searchParams?: Promise<{ adminInviteToken?: string | string[] }>;
}) {
  const { meetingSlug } = await params;
  const query = searchParams ? await searchParams : {};
  const adminInviteToken = Array.isArray(query.adminInviteToken)
    ? query.adminInviteToken[0]
    : query.adminInviteToken;
  const isConvexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <AppShell>
      {isConvexConfigured ? (
        <ConnectedPublicParticipantMeeting
          meetingSlug={meetingSlug}
          adminInviteToken={adminInviteToken}
        />
      ) : (
        <RoutePlaceholder
          icon={UsersRound}
          eyebrow="Public meeting"
          title="Participant availability"
          description={`Set NEXT_PUBLIC_CONVEX_URL to load ${meetingSlug} and save participant availability.`}
        />
      )}
    </AppShell>
  );
}
