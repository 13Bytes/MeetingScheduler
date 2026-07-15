import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeetingResultsPanel } from "@/components/meeting-results-panel";
import type { MeetingResults, ScoredCandidateSlot } from "@/lib/meeting-results";

const candidateFixture: ScoredCandidateSlot = {
  startUtc: "2026-06-25T07:00:00.000Z",
  endUtc: "2026-06-25T08:00:00.000Z",
  timeZone: "Europe/Berlin",
  coveredCellKeys: [
    "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
    "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
  ],
  availableParticipantCount: 2,
  unavailableParticipantCount: 0,
  totalParticipantCount: 2,
  reluctantVoteCount: 1,
  yesVoteCount: 3,
  scorePercent: 100,
  rank: 1,
  participantDetails: [
    {
      membershipId: "alice",
      displayName: "Alice",
      responses: ["yes", "yes"],
      reluctantCount: 0,
    },
    {
      membershipId: "bruno",
      displayName: "Bruno",
      responses: ["yes", "reluctant"],
      reluctantCount: 1,
    },
  ],
};

const detailedResults: MeetingResults = {
  generatedAt: 123,
  timeZone: "Europe/Berlin",
  granularityMinutes: 30,
  durationMinutes: 60,
  totalParticipantCount: 2,
  votedParticipantCount: 2,
  availabilityCount: 4,
  candidateCount: 1,
  detailsVisible: true,
  candidates: [candidateFixture],
  shortlist: [candidateFixture],
  votedParticipants: [
    { membershipId: "alice", displayName: "Alice" },
    { membershipId: "bruno", displayName: "Bruno" },
  ],
};

describe("MeetingResultsPanel", () => {
  it("shows a recommended shortlist and detailed participant names when provided", () => {
    render(<MeetingResultsPanel results={detailedResults} canAdminister />);

    expect(screen.getByText(/best times/i)).toBeInTheDocument();
    expect(screen.getByText(/organizer/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 can attend/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 participants have responded/i)).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bruno/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Bruno \(1 if needed\)/i)).toBeInTheDocument();
  });

  it("hides zero-attendee slots from recommendations and the heatmap", () => {
    const unavailableCandidate: ScoredCandidateSlot = {
      ...candidateFixture,
      startUtc: "2026-06-25T08:00:00.000Z",
      endUtc: "2026-06-25T09:00:00.000Z",
      availableParticipantCount: 0,
      unavailableParticipantCount: 2,
      reluctantVoteCount: 0,
      yesVoteCount: 0,
      scorePercent: 0,
      rank: 2,
      participantDetails: [],
    };

    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          candidateCount: 2,
          candidates: [candidateFixture, unavailableCandidate],
          shortlist: [candidateFixture, unavailableCandidate],
        }}
      />,
    );

    expect(screen.getByText(/best times/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 can attend/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 2 can attend/i)).not.toBeInTheDocument();
    expect(screen.queryByText("0/2")).not.toBeInTheDocument();
  });

  it("shows an empty shortlist state when all candidates have zero attendees", () => {
    const unavailableCandidate: ScoredCandidateSlot = {
      ...candidateFixture,
      availableParticipantCount: 0,
      unavailableParticipantCount: 2,
      reluctantVoteCount: 0,
      yesVoteCount: 0,
      scorePercent: 0,
      participantDetails: [],
    };

    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          candidates: [unavailableCandidate],
          shortlist: [unavailableCandidate],
        }}
      />,
    );

    expect(screen.getByText(/best times/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/no available times match the responses yet/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/0 of 2 can attend/i)).not.toBeInTheDocument();
  });

  it("does not render individual names for summary-only payloads", () => {
    const summaryOnlyDetailedResults = { ...detailedResults };
    delete summaryOnlyDetailedResults.votedParticipants;
    const summaryResults: MeetingResults = {
      ...summaryOnlyDetailedResults,
      detailsVisible: false,
      candidates: detailedResults.candidates.map((candidate) => {
        const summary = { ...candidate };
        delete summary.participantDetails;
        return summary;
      }),
      shortlist: detailedResults.shortlist.map((candidate) => {
        const summary = { ...candidate };
        delete summary.participantDetails;
        return summary;
      }),
    };

    render(<MeetingResultsPanel results={summaryResults} />);

    expect(screen.getByText(/summary only/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 can attend/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 participants have responded/i)).toBeInTheDocument();
    expect(screen.getByText(/names are hidden/i)).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bruno/i)).not.toBeInTheDocument();
  });

  it("hides the recommended shortlist before participants join", () => {
    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          totalParticipantCount: 0,
          availabilityCount: 0,
          candidateCount: 0,
          candidates: [],
          shortlist: [],
        }}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: /^best times$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting for responses/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no participants have joined yet/i),
    ).not.toBeInTheDocument();
  });

  it("shows waiting context until availability is submitted", () => {
    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          availabilityCount: 0,
        }}
        canAdminister
        canFinalize
      />,
    );

    expect(
      screen.queryByRole("heading", { name: /^best times$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /choose the final time/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /availability comparison/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/recommendations will appear after someone saves availability/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/awaiting availability/i)).toBeInTheDocument();
    expect(screen.getByText(/best times will appear/i)).toBeInTheDocument();
  });

  it("explains when voted availability cannot form a full meeting window", () => {
    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          candidateCount: 0,
          candidates: [],
          shortlist: [],
        }}
      />,
    );

    expect(
      screen.getAllByText(/selected time windows are too short for this meeting/i),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/comparison will appear once participants share/i),
    ).not.toBeInTheDocument();
  });

  it("lets admins finalize the recommended shortlist selection", async () => {
    const onFinalize = vi.fn().mockResolvedValue(undefined);
    render(
      <MeetingResultsPanel
        results={detailedResults}
        canAdminister
        canFinalize
        onFinalize={onFinalize}
      />,
    );

    expect(
      screen.getByText(/confirm thu, jun 25, 9:00 am-10:00 am/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 response cell marking.*if needed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /finalize selected time/i }));

    await waitFor(() =>
      expect(onFinalize).toHaveBeenCalledWith({
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T08:00:00.000Z",
        timeZone: "Europe/Berlin",
      }),
    );
  });

  it("lets admins override recommendations with any candidate slot", async () => {
    const overrideCandidate: ScoredCandidateSlot = {
      ...candidateFixture,
      startUtc: "2026-06-25T08:00:00.000Z",
      endUtc: "2026-06-25T09:00:00.000Z",
      rank: 2,
      availableParticipantCount: 1,
      unavailableParticipantCount: 1,
      scorePercent: 50,
    };
    const onFinalize = vi.fn().mockResolvedValue(undefined);
    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          candidateCount: 2,
          candidates: [candidateFixture, overrideCandidate],
          shortlist: [candidateFixture],
        }}
        canAdminister
        canFinalize
        onFinalize={onFinalize}
      />,
    );

    fireEvent.change(screen.getByLabelText(/override final slot/i), {
      target: { value: "2026-06-25T08:00:00.000Z_2026-06-25T09:00:00.000Z" },
    });
    fireEvent.click(screen.getByRole("button", { name: /finalize selected time/i }));

    await waitFor(() =>
      expect(onFinalize).toHaveBeenCalledWith({
        startUtc: "2026-06-25T08:00:00.000Z",
        endUtc: "2026-06-25T09:00:00.000Z",
        timeZone: "Europe/Berlin",
      }),
    );
  });

  it("normalizes stale override selections after candidate refreshes", async () => {
    const overrideCandidate: ScoredCandidateSlot = {
      ...candidateFixture,
      startUtc: "2026-06-25T08:00:00.000Z",
      endUtc: "2026-06-25T09:00:00.000Z",
      rank: 2,
      availableParticipantCount: 1,
      unavailableParticipantCount: 1,
      scorePercent: 50,
    };
    const onFinalize = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          candidateCount: 2,
          candidates: [candidateFixture, overrideCandidate],
          shortlist: [candidateFixture],
        }}
        canAdminister
        canFinalize
        onFinalize={onFinalize}
      />,
    );

    fireEvent.change(screen.getByLabelText(/override final slot/i), {
      target: { value: "2026-06-25T08:00:00.000Z_2026-06-25T09:00:00.000Z" },
    });
    rerender(
      <MeetingResultsPanel
        results={detailedResults}
        canAdminister
        canFinalize
        onFinalize={onFinalize}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /finalize selected time/i }));

    expect(screen.getByLabelText<HTMLSelectElement>(/override final slot/i).value).toBe(
      "2026-06-25T07:00:00.000Z_2026-06-25T08:00:00.000Z",
    );
    await waitFor(() =>
      expect(onFinalize).toHaveBeenCalledWith({
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T08:00:00.000Z",
        timeZone: "Europe/Berlin",
      }),
    );
  });

  it("shows the final selected slot and exposes reopen for admins", async () => {
    const onReopen = vi.fn().mockResolvedValue(undefined);
    render(
      <MeetingResultsPanel
        results={detailedResults}
        canAdminister
        lifecycleState="finalized"
        selectedSlot={{
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T08:00:00.000Z",
          timeZone: "Europe/Berlin",
        }}
        canReopen
        onReopen={onReopen}
      />,
    );

    expect(screen.getByText(/^final time$/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^best times$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/thu, jun 25, 9:00 am-10:00 am/i).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: /reopen responses/i }));

    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
  });
});
