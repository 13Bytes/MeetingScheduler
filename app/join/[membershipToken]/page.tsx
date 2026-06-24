import { KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default async function JoinByMembershipLinkPage({
  params,
}: {
  params: Promise<{ membershipToken: string }>;
}) {
  await params;

  return (
    <AppShell>
      <RoutePlaceholder
        icon={KeyRound}
        eyebrow="Secret membership link"
        title="Join meeting"
        description="Membership token detected. Later stages will resolve this bearer token through Convex before showing availability tools."
      />
    </AppShell>
  );
}
