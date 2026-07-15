import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CreatedMeetingHandoff } from "@/components/created-meeting-handoff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meeting created | Meeting Scheduler",
  robots: { index: false, follow: false },
};

export default async function CreatedMeetingPage({
  params,
}: {
  params: Promise<{ meetingSlug: string; adminMembershipToken: string }>;
}) {
  const { meetingSlug, adminMembershipToken } = await params;

  return (
    <AppShell>
      <CreatedMeetingHandoff
        meetingSlug={meetingSlug}
        adminMembershipToken={adminMembershipToken}
      />
    </AppShell>
  );
}
