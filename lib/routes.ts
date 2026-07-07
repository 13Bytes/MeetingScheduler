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
    purpose: "Landing and project foundation overview.",
  },
  {
    path: routes.newMeeting,
    purpose: "Anonymous meeting creation flow.",
  },
  {
    path: routes.identity,
    purpose: "Optional passwordless email verification request flow.",
  },
  {
    path: routes.identityDashboard,
    purpose: "Verified email recovery dashboard for attached memberships.",
  },
  {
    path: "/m/[meetingSlug]",
    purpose:
      "Public meeting poll route for joining and painting participant availability.",
  },
  {
    path: "/join/[membershipToken]",
    purpose:
      "Secret membership route for returning to a response and admin setup access.",
  },
] as const;
