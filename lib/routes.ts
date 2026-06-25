export const routes = {
  home: "/",
  newMeeting: "/new",
  meetingPoll: (meetingSlug: string) => `/m/${encodeURIComponent(meetingSlug)}`,
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
    path: "/m/[meetingSlug]",
    purpose: "Future public meeting poll and availability collaboration route.",
  },
  {
    path: "/join/[membershipToken]",
    purpose: "Secret membership link route for members and admins.",
  },
] as const;
