export const routes = {
  home: "/",
  newMeeting: "/new",
  identity: "/identity",
  identityDashboard: "/identity/dashboard",
  meetingPoll: (meetingSlug: string) => `/m/${encodeURIComponent(meetingSlug)}`,
  adminInvite: (meetingSlug: string, adminInviteToken: string) => {
    const params = new URLSearchParams({ adminInviteToken });
    return `/m/${encodeURIComponent(meetingSlug)}#${params.toString()}`;
  },
  membershipLink: (membershipToken: string) =>
    `/join/${encodeURIComponent(membershipToken)}`,
} as const;

export function buildAbsoluteAppUrl(path: string, origin: string): string {
  if (!path.startsWith("/")) {
    throw new Error("App paths must start with /");
  }

  return new URL(path, normalizeOrigin(origin)).toString();
}

export function buildCreatedMeetingLinks({
  origin,
  meetingSlug,
  adminMembershipToken,
}: {
  origin: string;
  meetingSlug: string;
  adminMembershipToken: string;
}) {
  return {
    publicParticipantUrl: buildAbsoluteAppUrl(routes.meetingPoll(meetingSlug), origin),
    adminMembershipUrl: buildAbsoluteAppUrl(
      routes.membershipLink(adminMembershipToken),
      origin,
    ),
  };
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.host}`;
}

export const routeMap = [
  {
    path: routes.home,
    purpose: "Meeting Scheduler home page.",
  },
  {
    path: routes.newMeeting,
    purpose: "Create a meeting without an account.",
  },
  {
    path: routes.identity,
    purpose: "Sign in securely by email.",
  },
  {
    path: routes.identityDashboard,
    purpose: "View meetings associated with a verified email.",
  },
  {
    path: "/m/[meetingSlug]",
    purpose: "Open a meeting and share participant availability.",
  },
  {
    path: "/join/[membershipToken]",
    purpose: "Return to a meeting with private participant or organizer access.",
  },
] as const;
