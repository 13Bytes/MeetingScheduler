import { CalendarPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RoutePlaceholder } from "@/components/route-placeholder";

export default function NewMeetingPage() {
  return (
    <AppShell>
      <RoutePlaceholder
        icon={CalendarPlus}
        eyebrow="Route placeholder"
        title="Create a meeting"
        description="Stage 1 will add meeting creation here. Stage 0 keeps this route present for navigation, deployment checks, and future implementation."
      />
    </AppShell>
  );
}
