import { KeyRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ConnectedAdminCalendarPainter } from "@/components/admin-calendar-painter";
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
        <ConnectedAdminCalendarPainter membershipToken={membershipToken} />
      ) : (
        <RoutePlaceholder
          icon={KeyRound}
          eyebrow="Secret membership link"
          title="Admin calendar setup"
          description="Set NEXT_PUBLIC_CONVEX_URL to resolve the membership link and edit allowed meeting regions."
        />
      )}
    </AppShell>
  );
}
