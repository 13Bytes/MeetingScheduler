import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { RecoverMembershipLinkButton } from "@/components/identity-dashboard-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { routes } from "@/lib/routes";

export type IdentityMeetingsDashboard = {
  user?: {
    userId: string;
  };
  identity: {
    normalizedEmail: string;
  };
  verifiedEmails?: {
    emailIdentityId: string;
    normalizedEmail: string;
    verifiedAt?: number;
  }[];
  memberships: {
    membershipId: string;
    role: "admin" | "member";
    displayName?: string;
    hasAvailability: boolean;
    canRecover: boolean;
    meeting: {
      title: string;
      slug: string;
      lifecycleState: "open" | "finalized";
    };
  }[];
};

export function IdentityMeetingsList({
  dashboard,
  emptyMessage = "You have not created or joined any meetings yet.",
}: {
  dashboard: IdentityMeetingsDashboard;
  emptyMessage?: string;
}) {
  if (dashboard.memberships.length === 0) {
    return (
      <Card>
        <CardContent className="grid min-h-48 place-items-center pt-5 text-center text-sm leading-6 text-slate-600">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      {dashboard.verifiedEmails && dashboard.verifiedEmails.length > 0 ? (
        <div className="rounded-md border border-border bg-surface-muted p-3 text-sm leading-6 text-slate-600">
          Verified email{dashboard.verifiedEmails.length === 1 ? "" : "s"}:{" "}
          <span className="font-medium text-foreground">
            {dashboard.verifiedEmails
              .map((identity) => identity.normalizedEmail)
              .join(", ")}
          </span>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {dashboard.memberships.map((membership) => (
          <Card key={membership.membershipId}>
            <CardHeader>
              <CardTitle className="flex items-start gap-2">
                <CalendarDays className="size-5 text-primary" aria-hidden="true" />
                <span className="min-w-0 break-words">{membership.meeting.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{membership.role === "admin" ? "Organizer" : "Participant"}</Badge>
                {membership.hasAvailability ? <Badge>Response saved</Badge> : null}
                <Badge>
                  {membership.meeting.lifecycleState === "finalized"
                    ? "Finalized"
                    : "Open"}
                </Badge>
              </div>
              {membership.displayName ? (
                <p className="text-sm leading-6 text-slate-600">
                  Responding as {membership.displayName}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="ghost">
                  <Link href={routes.meetingPoll(membership.meeting.slug)}>
                    Open meeting
                  </Link>
                </Button>
              </div>
              {membership.canRecover ? (
                <RecoverMembershipLinkButton membershipId={membership.membershipId} />
              ) : (
                <p className="text-sm leading-6 text-slate-600">
                  Add your availability to keep this meeting in your list.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
