import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeetingResultsPanel } from "@/components/meeting-results-panel";
import type { MeetingResults } from "@/lib/meeting-results";

const detailedResults: MeetingResults = {
  generatedAt: 123,
  timeZone: "Europe/Berlin",
  granularityMinutes: 30,
  durationMinutes: 60,
  totalParticipantCount: 2,
  candidateCount: 1,
  detailsVisible: true,
  candidates: [
    {
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
    },
  ],
  shortlist: [],
};
detailedResults.shortlist = detailedResults.candidates;

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

  it("explains the empty state before participants join", () => {
    render(
      <MeetingResultsPanel
        results={{
          ...detailedResults,
          totalParticipantCount: 0,
          candidateCount: 0,
          candidates: [],
          shortlist: [],
        }}
      />,
    );

    expect(screen.getByText(/no participants have joined yet/i)).toBeInTheDocument();
  });
});
