export const routes = {
  home: "/",
  newMeeting: "/new",
  meetingPoll: (meetingSlug: string) => `/m/${encodeURIComponent(meetingSlug)}`,
  meetingAdmin: (meetingSlug: string, adminToken: string) =>
    `/m/${encodeURIComponent(meetingSlug)}/admin/${encodeURIComponent(adminToken)}`,
  membershipLink: (membershipToken: string) =>
    `/join/${encodeURIComponent(membershipToken)}`,
} as const;

export const routeMap = [
  {
    path: routes.home,
    purpose: "Landing and project foundation overview.",
  },
  {
    path: routes.newMeeting,
    purpose: "Future meeting creation flow.",
  },
  {
    path: "/m/[meetingSlug]",
    purpose: "Future public meeting poll and availability collaboration route.",
  },
  {
    path: "/m/[meetingSlug]/admin/[adminToken]",
    purpose: "Future organizer route reached by secret admin link.",
  },
  {
    path: "/join/[membershipToken]",
    purpose: "Future secret membership link route.",
  },
] as const;
