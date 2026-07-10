import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedPublicParticipantMeeting,
  ParticipantAvailabilityPainter,
} from "@/components/participant-availability-painter";
import type { MeetingResults } from "@/lib/meeting-results";

const {
  createAdminMembershipFromInviteMock,
  createParticipantMembershipMock,
  createAdminInviteTokenMock,
  finalizeMeetingMock,
  reopenMeetingMock,
  saveAvailabilityRecordsMock,
  updateMembershipDisplayNameMock,
  useMutationMock,
  useQueryMock,
} = vi.hoisted(() => ({
  createAdminMembershipFromInviteMock: vi.fn(),
  createParticipantMembershipMock: vi.fn(),
  createAdminInviteTokenMock: vi.fn(),
  finalizeMeetingMock: vi.fn(),
  reopenMeetingMock: vi.fn(),
  saveAvailabilityRecordsMock: vi.fn(),
  updateMembershipDisplayNameMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    meetings: {
      createParticipantMembership: "meetings:createParticipantMembership",
      createAdminMembershipFromInvite: "meetings:createAdminMembershipFromInvite",
      createAdminInviteToken: "meetings:createAdminInviteToken",
      saveAvailabilityRecords: "meetings:saveAvailabilityRecords",
      updateMembershipDisplayName: "meetings:updateMembershipDisplayName",
      finalizeMeeting: "meetings:finalizeMeeting",
      reopenMeeting: "meetings:reopenMeeting",
      readPublicMeetingBySlug: "meetings:readPublicMeetingBySlug",
      readParticipantMeetingByMembershipToken:
        "meetings:readParticipantMeetingByMembershipToken",
      readMeetingByMembershipToken: "meetings:readMeetingByMembershipToken",
      updateMeetingSettings: "meetings:updateMeetingSettings",
    },
  },
}));

const meeting = {
  title: "Team planning",
  slug: "team-planning",
  lifecycleState: "open" as const,
  adminMode: "roleBased" as const,
  canonicalTimeZone: "Europe/Berlin",
  granularityMinutes: 30,
  durationMinutes: 60,
  allowedTimeRanges: [
    {
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T09:00:00.000Z",
      timeZone: "Europe/Berlin",
    },
  ],
};

const baseData = {
  meeting,
  capabilities: {
    canAdminister: false,
    canEditAvailability: true,
  },
  ownAvailabilityRecords: [],
};

const results: MeetingResults = {
  generatedAt: 123,
  timeZone: "Europe/Berlin",
  granularityMinutes: 30,
  durationMinutes: 60,
  totalParticipantCount: 1,
  votedParticipantCount: 1,
  availabilityCount: 2,
  candidateCount: 1,
  detailsVisible: false,
  candidates: [
    {
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T08:00:00.000Z",
      timeZone: "Europe/Berlin",
      coveredCellKeys: [
        "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
        "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
      ],
      availableParticipantCount: 1,
      unavailableParticipantCount: 0,
      totalParticipantCount: 1,
      reluctantVoteCount: 0,
      yesVoteCount: 2,
      scorePercent: 100,
      rank: 1,
    },
  ],
  shortlist: [
    {
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T08:00:00.000Z",
      timeZone: "Europe/Berlin",
      coveredCellKeys: [
        "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
        "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
      ],
      availableParticipantCount: 1,
      unavailableParticipantCount: 0,
      totalParticipantCount: 1,
      reluctantVoteCount: 0,
      yesVoteCount: 2,
      scorePercent: 100,
      rank: 1,
    },
  ],
};

describe("ParticipantAvailabilityPainter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "ms_membership_team-planning=; Path=/; Max-Age=0; SameSite=Lax";
    window.history.replaceState(null, "", "/");
    createAdminMembershipFromInviteMock.mockReset();
    createParticipantMembershipMock.mockReset();
    createAdminInviteTokenMock.mockReset();
    finalizeMeetingMock.mockReset();
    reopenMeetingMock.mockReset();
    saveAvailabilityRecordsMock.mockReset();
    updateMembershipDisplayNameMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockImplementation((functionReference) => {
      if (functionReference === "meetings:createParticipantMembership") {
        return createParticipantMembershipMock;
      }
      if (functionReference === "meetings:createAdminMembershipFromInvite") {
        return createAdminMembershipFromInviteMock;
      }
      if (functionReference === "meetings:createAdminInviteToken") {
        return createAdminInviteTokenMock;
      }
      if (functionReference === "meetings:saveAvailabilityRecords") {
        return saveAvailabilityRecordsMock;
      }
      if (functionReference === "meetings:updateMembershipDisplayName") {
        return updateMembershipDisplayNameMock;
      }
      if (functionReference === "meetings:finalizeMeeting") {
        return finalizeMeetingMock;
      }
      if (functionReference === "meetings:reopenMeeting") {
        return reopenMeetingMock;
      }
      return vi.fn();
    });
  });

  it("requires a display name before creating a public-link membership", async () => {
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={vi.fn()}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    expect(
      await screen.findByText(/enter your display name before saving availability/i),
    ).toBeInTheDocument();
  });

  it("always displays the regular invite link on the meeting page", () => {
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={vi.fn()}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(screen.getByRole("textbox", { name: /regular invite link/i })).toHaveValue(
      "http://localhost:3000/m/team-planning",
    );
    expect(screen.queryByRole("textbox", { name: /admin invite link/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /private return link/i })).toBeNull();
  });

  it("uses a client-side admin invite token when joining from an invite link", async () => {
    window.history.replaceState(
      null,
      "",
      "/m/team-planning#adminInviteToken=admin-invite-secret",
    );
    useQueryMock.mockImplementation((_query, args) =>
      args === "skip"
        ? null
        : {
            meeting,
            capabilities: {
              canAdminister: false,
              canEditAvailability: true,
            },
            results,
          },
    );
    createAdminMembershipFromInviteMock.mockResolvedValue({
      membershipToken: "admin-member-secret-token",
    });

    render(<ConnectedPublicParticipantMeeting meetingSlug="team-planning" />);

    await waitFor(() => expect(window.location.hash).toBe(""));
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    await waitFor(() =>
      expect(createAdminMembershipFromInviteMock).toHaveBeenCalledWith({
        meetingSlug: "team-planning",
        adminInviteToken: "admin-invite-secret",
        displayName: "Grace Hopper",
        privacyMode: "detailed",
        clientRateLimitKey: expect.any(String),
      }),
    );
  });

  it("keeps a valid remembered membership when an admin invite is present", () => {
    window.localStorage.setItem(
      "meeting-scheduler.membership-token.team-planning",
      "remembered-member-token",
    );
    window.history.replaceState(
      null,
      "",
      "/m/team-planning#adminInviteToken=admin-invite-secret",
    );
    useQueryMock.mockImplementation((_query, args) => {
      if (args && args !== "skip" && "membershipToken" in args) {
        return {
          meeting,
          membership: { role: "member", displayName: "Ada Lovelace" },
          capabilities: {
            canAdminister: false,
            canEditAvailability: true,
          },
          ownAvailabilityRecords: [],
          results,
        };
      }
      return {
        meeting,
        capabilities: {
          canAdminister: false,
          canEditAvailability: true,
        },
        results,
      };
    });

    render(<ConnectedPublicParticipantMeeting meetingSlug="team-planning" />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      membershipToken: "remembered-member-token",
    });
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("shows the availability workflow before results until the viewer has voted", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{ ...baseData, results }}
        onCreateMembership={vi.fn()}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    const availabilityHeading = screen.getByRole("heading", {
      name: /availability calendar/i,
    });
    const resultsHeading = screen.getByRole("heading", {
      name: /recommended shortlist/i,
    });

    expect(
      availabilityHeading.compareDocumentPosition(resultsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps results before the availability workflow after the viewer has voted", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
          ownAvailabilityRecords: [
            {
              cellKey: "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
              startUtc: "2026-06-25T07:00:00.000Z",
              endUtc: "2026-06-25T07:30:00.000Z",
              timeZone: "Europe/Berlin",
              response: "yes",
            },
          ],
          results,
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    const resultsHeading = screen.getByRole("heading", {
      name: /recommended shortlist/i,
    });
    const availabilityHeading = screen.getByRole("heading", {
      name: /availability calendar/i,
    });

    expect(
      resultsHeading.compareDocumentPosition(availabilityHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows regular and private links for returning regular users", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(screen.getByRole("textbox", { name: /regular invite link/i })).toHaveValue(
      "http://localhost:3000/m/team-planning",
    );
    expect(screen.queryByRole("textbox", { name: /admin invite link/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: /private return link/i })).toHaveValue(
      "http://localhost:3000/join/member-secret-token",
    );
    expect(screen.getByText(/only for you/i)).toBeInTheDocument();
  });

  it("shows an admin invite link for role-based admin users", async () => {
    const onCreateAdminInviteToken = vi
      .fn()
      .mockResolvedValue({ adminInviteToken: "admin-invite-secret" });

    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "admin", displayName: "Grace Hopper" },
          capabilities: {
            canAdminister: true,
            canEditAvailability: true,
          },
        }}
        existingMembershipToken="admin-secret-token"
        onSaveAvailability={vi.fn()}
        onCreateAdminInviteToken={onCreateAdminInviteToken}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    await waitFor(() =>
      expect(onCreateAdminInviteToken).toHaveBeenCalledWith("admin-secret-token"),
    );
    expect(screen.getByRole("textbox", { name: /regular invite link/i })).toHaveValue(
      "http://localhost:3000/m/team-planning",
    );
    expect(screen.getByRole("textbox", { name: /admin invite link/i })).toHaveValue(
      "http://localhost:3000/m/team-planning#adminInviteToken=admin-invite-secret",
    );
    expect(screen.getByRole("textbox", { name: /private return link/i })).toHaveValue(
      "http://localhost:3000/join/admin-secret-token",
    );
  });

  it("does not show a separate admin invite when everyone is admin", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          meeting: { ...meeting, adminMode: "everyoneAdmin" },
          membership: { role: "member", displayName: "Ada Lovelace" },
          capabilities: {
            canAdminister: true,
            canEditAvailability: true,
          },
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        onCreateAdminInviteToken={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(screen.getByRole("textbox", { name: /regular invite link/i })).toHaveValue(
      "http://localhost:3000/m/team-planning",
    );
    expect(screen.queryByRole("textbox", { name: /admin invite link/i })).toBeNull();
  });

  it("creates a membership before the first persisted availability write", async () => {
    const onCreateMembership = vi
      .fn()
      .mockResolvedValue({ membershipToken: "member-secret-token" });
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    const onMembershipTokenAvailable = vi.fn();
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={onCreateMembership}
        onSaveAvailability={onSaveAvailability}
        onMembershipTokenAvailable={onMembershipTokenAvailable}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    await waitFor(() => expect(onCreateMembership).toHaveBeenCalledWith("Ada Lovelace"));
    await waitFor(() =>
      expect(onSaveAvailability).toHaveBeenCalledWith("member-secret-token", [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T07:30:00.000Z",
          timeZone: "Europe/Berlin",
          response: "yes",
        },
      ]),
    );
    expect(
      (
        await screen.findByRole("textbox", { name: /^private return link$/i })
      ).getAttribute("value"),
    ).toContain("/join/member-secret-token");
    expect(onMembershipTokenAvailable).toHaveBeenCalledWith(
      "member-secret-token",
      "team-planning",
    );
  });

  it("lets a mobile user mark a range with separate start and end taps", () => {
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={vi.fn()}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mark a range/i }));
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:30 unset/i }), {
      key: "Enter",
    });

    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:30 yes/i }),
    ).toBeInTheDocument();
  });

  it("shows a joined notice when saving a public membership without painted cells", async () => {
    const onCreateMembership = vi
      .fn()
      .mockResolvedValue({ membershipToken: "member-secret-token" });
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantAvailabilityPainter
        data={baseData}
        onCreateMembership={onCreateMembership}
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join and save/i }));

    expect(await screen.findByText(/joined meeting/i)).toBeInTheDocument();
    expect(onCreateMembership).toHaveBeenCalledWith("Ada Lovelace");
    expect(onSaveAvailability).not.toHaveBeenCalled();
  });

  it("does not clobber unsaved paint edits when membership data refreshes", () => {
    const { rerender } = render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }),
    ).toBeInTheDocument();

    rerender(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
          ownAvailabilityRecords: [
            {
              cellKey: "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
              startUtc: "2026-06-25T07:30:00.000Z",
              endUtc: "2026-06-25T08:00:00.000Z",
              timeZone: "Europe/Berlin",
              response: "no",
            },
          ],
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(
      screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }),
    ).toBeInTheDocument();
  });

  it("lets returning members clear their own persisted response", async () => {
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    const cellKey = "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z";
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "member", displayName: "Ada Lovelace" },
          ownAvailabilityRecords: [
            {
              cellKey,
              startUtc: "2026-06-25T07:00:00.000Z",
              endUtc: "2026-06-25T07:30:00.000Z",
              timeZone: "Europe/Berlin",
              response: "yes",
            },
          ],
        }}
        existingMembershipToken="member-secret-token"
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 yes/i }), {
      key: " ",
    });
    fireEvent.click(screen.getByRole("button", { name: /save response/i }));

    await waitFor(() =>
      expect(onSaveAvailability).toHaveBeenCalledWith("member-secret-token", [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T07:30:00.000Z",
          timeZone: "Europe/Berlin",
        },
      ]),
    );
  });

  it("updates a nameless existing membership before saving availability", async () => {
    const onUpdateDisplayName = vi.fn().mockResolvedValue(undefined);
    const onSaveAvailability = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          membership: { role: "admin" },
        }}
        existingMembershipToken="admin-secret-token"
        onUpdateDisplayName={onUpdateDisplayName}
        onSaveAvailability={onSaveAvailability}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /thu jun 25 09:00 unset/i }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: /save response/i }));

    await waitFor(() =>
      expect(onUpdateDisplayName).toHaveBeenCalledWith(
        "admin-secret-token",
        "Grace Hopper",
      ),
    );
    expect(onSaveAvailability).toHaveBeenCalledWith("admin-secret-token", [
      expect.objectContaining({ response: "yes" }),
    ]);
  });

  it("keeps finalized meetings read-only", () => {
    render(
      <ParticipantAvailabilityPainter
        data={{
          ...baseData,
          meeting: {
            ...meeting,
            lifecycleState: "finalized",
            finalizedSlot: {
              startUtc: "2026-06-25T07:00:00.000Z",
              endUtc: "2026-06-25T08:00:00.000Z",
              timeZone: "Europe/Berlin",
            },
          },
          capabilities: { canAdminister: false, canEditAvailability: false },
          results,
        }}
        onSaveAvailability={vi.fn()}
        baseDate={new Date("2026-06-25T06:00:00.000Z")}
      />,
    );

    expect(screen.getByText(/finalized meeting/i)).toBeInTheDocument();
    expect(screen.getByText(/final time/i)).toBeInTheDocument();
    expect(screen.getAllByText(/thu, jun 25, 9:00 am-10:00 am/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("button", { name: /join and save/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^yes$/i })).toBeDisabled();
  });
});
