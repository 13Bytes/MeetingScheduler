import { KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConnectedMembershipAvailability } from "@/components/participant-availability-painter";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default async function JoinByMembershipLinkPage({
  params,
}: {
  params: Promise<{ membershipToken: string }>;
}) {
  const { membershipToken } = await params;
  const isConvexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <AppShell>
      {isConvexConfigured ? (
        <ConnectedMembershipAvailability membershipToken={membershipToken} />
      ) : (
        <RoutePlaceholder
          icon={KeyRound}
          eyebrow="Secret membership link"
          title="Participant availability"
          description="Set NEXT_PUBLIC_CONVEX_URL to resolve the membership link and edit availability."
        />
      )}
    </AppShell>
  );
}
