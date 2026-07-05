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
  availabilityCount: 4,
  candidateCount: 1,
  detailsVisible: true,
  candidates: [candidateFixture],
  shortlist: [candidateFixture],
};

describe("MeetingResultsPanel", () => {
  it("shows a recommended shortlist and detailed participant names when provided", () => {
    render(<MeetingResultsPanel results={detailedResults} canAdminister />);

    expect(screen.getByText(/recommended shortlist/i)).toBeInTheDocument();
    expect(screen.getByText(/admin view/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 can attend/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/Bruno \(1 reluctant\)/i)).toBeInTheDocument();
  });

  it("does not render individual names for summary-only payloads", () => {
    const summaryResults: MeetingResults = {
      ...detailedResults,
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

    expect(screen.queryByText(/recommended shortlist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/results pending/i)).not.toBeInTheDocument();
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

    expect(screen.queryByText(/recommended shortlist/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /final selection/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /score heatmap/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/recommendations will appear after someone saves availability/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/awaiting availability/i)).toBeInTheDocument();
    expect(
      screen.getByText(/final selection and score heatmap will appear/i),
    ).toBeInTheDocument();
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

    expect(screen.getByText(/final time/i)).toBeInTheDocument();
    expect(screen.queryByText(/recommended shortlist/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/thu, jun 25, 9:00 am-10:00 am/i).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: /reopen poll/i }));

    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
  });
});
