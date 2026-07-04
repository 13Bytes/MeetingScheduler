import { describe, expect, it } from "vitest";
import {
  buildMeetingResults,
  canViewerReadDetailedResults,
  generateCandidateSlots,
  makeResultCellKey,
  rankScoredCandidates,
  redactMeetingResults,
  scoreCandidate,
  type CandidateSlot,
  type MeetingResults,
  type ResultAvailabilityRecord,
  type ResultParticipant,
} from "@/lib/meeting-results";

const ranges = [
  {
    startUtc: "2026-06-25T07:00:00.000Z",
    endUtc: "2026-06-25T09:00:00.000Z",
    timeZone: "Europe/Berlin",
  },
];

const participants: ResultParticipant[] = [
  {
    membershipId: "alice",
    displayName: "Alice",
    role: "member",
    privacyMode: "detailed",
  },
  {
    membershipId: "bruno",
    displayName: "Bruno",
    role: "member",
    privacyMode: "detailed",
  },
];

describe("candidate slot generation", () => {
  it("generates meeting-length candidates from every fully covered allowed cell run", () => {
    const candidates = generateCandidateSlots({
      allowedTimeRanges: ranges,
      granularityMinutes: 30,
      durationMinutes: 60,
      timeZone: "Europe/Berlin",
    });

    expect(candidates).toEqual([
      {
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T08:00:00.000Z",
        timeZone: "Europe/Berlin",
        coveredCellKeys: [
          "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
          "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
        ],
      },
      {
        startUtc: "2026-06-25T07:30:00.000Z",
        endUtc: "2026-06-25T08:30:00.000Z",
        timeZone: "Europe/Berlin",
        coveredCellKeys: [
          "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
          "2026-06-25T08:00:00.000Z_2026-06-25T08:30:00.000Z",
        ],
      },
      {
        startUtc: "2026-06-25T08:00:00.000Z",
        endUtc: "2026-06-25T09:00:00.000Z",
        timeZone: "Europe/Berlin",
        coveredCellKeys: [
          "2026-06-25T08:00:00.000Z_2026-06-25T08:30:00.000Z",
          "2026-06-25T08:30:00.000Z_2026-06-25T09:00:00.000Z",
        ],
      },
    ]);
  });

  it("allows candidates to span adjacent admin ranges when every covered cell is allowed", () => {
    const candidates = generateCandidateSlots({
      allowedTimeRanges: [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T07:30:00.000Z",
          timeZone: "Europe/Berlin",
        },
        {
          startUtc: "2026-06-25T07:30:00.000Z",
          endUtc: "2026-06-25T08:00:00.000Z",
          timeZone: "Europe/Berlin",
        },
      ],
      granularityMinutes: 30,
      durationMinutes: 60,
      timeZone: "Europe/Berlin",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      startUtc: "2026-06-25T07:00:00.000Z",
      endUtc: "2026-06-25T08:00:00.000Z",
    });
  });

  it("uses canonical UTC cell data across non-hour-offset timezones", () => {
    const candidates = generateCandidateSlots({
      allowedTimeRanges: [
        {
          startUtc: "2026-06-23T18:15:00.000Z",
          endUtc: "2026-06-23T19:00:00.000Z",
          timeZone: "Asia/Kathmandu",
        },
      ],
      granularityMinutes: 15,
      durationMinutes: 30,
      timeZone: "Asia/Kathmandu",
    });

    expect(candidates.map((candidate) => candidate.startUtc)).toEqual([
      "2026-06-23T18:15:00.000Z",
      "2026-06-23T18:30:00.000Z",
    ]);
  });
});

describe("candidate scoring and ranking", () => {
  const candidate: CandidateSlot = {
    startUtc: "2026-06-25T07:00:00.000Z",
    endUtc: "2026-06-25T08:00:00.000Z",
    timeZone: "Europe/Berlin",
    coveredCellKeys: [
      makeResultCellKey("2026-06-25T07:00:00.000Z", "2026-06-25T07:30:00.000Z"),
      makeResultCellKey("2026-06-25T07:30:00.000Z", "2026-06-25T08:00:00.000Z"),
    ],
  };

  it("counts a participant as available only when every covered cell is yes or reluctant", () => {
    const records: ResultAvailabilityRecord[] = [
      {
        membershipId: "alice",
        cellKey: candidate.coveredCellKeys[0],
        response: "yes",
      },
      {
        membershipId: "alice",
        cellKey: candidate.coveredCellKeys[1],
        response: "reluctant",
      },
      {
        membershipId: "bruno",
        cellKey: candidate.coveredCellKeys[0],
        response: "yes",
      },
    ];
    const responses = new Map([
      [
        "alice",
        new Map(
          records
            .filter((record) => record.membershipId === "alice")
            .map((record) => [record.cellKey, record.response]),
        ),
      ],
      [
        "bruno",
        new Map(
          records
            .filter((record) => record.membershipId === "bruno")
            .map((record) => [record.cellKey, record.response]),
        ),
      ],
    ]);

    expect(scoreCandidate(candidate, participants, responses)).toMatchObject({
      availableParticipantCount: 1,
      unavailableParticipantCount: 1,
      reluctantVoteCount: 1,
      yesVoteCount: 1,
      scorePercent: 50,
    });
  });

  it("ranks by able participants, then fewer reluctant votes, then earliest start", () => {
    const ranked = rankScoredCandidates([
      {
        ...candidate,
        startUtc: "2026-06-25T08:00:00.000Z",
        endUtc: "2026-06-25T09:00:00.000Z",
        availableParticipantCount: 2,
        unavailableParticipantCount: 0,
        totalParticipantCount: 2,
        reluctantVoteCount: 1,
        yesVoteCount: 3,
        scorePercent: 100,
      },
      {
        ...candidate,
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T08:00:00.000Z",
        availableParticipantCount: 2,
        unavailableParticipantCount: 0,
        totalParticipantCount: 2,
        reluctantVoteCount: 0,
        yesVoteCount: 4,
        scorePercent: 100,
      },
      {
        ...candidate,
        startUtc: "2026-06-25T06:00:00.000Z",
        endUtc: "2026-06-25T07:00:00.000Z",
        availableParticipantCount: 1,
        unavailableParticipantCount: 1,
        totalParticipantCount: 2,
        reluctantVoteCount: 0,
        yesVoteCount: 2,
        scorePercent: 50,
      },
    ]);

    expect(ranked.map((slot) => [slot.rank, slot.startUtc])).toEqual([
      [1, "2026-06-25T07:00:00.000Z"],
      [2, "2026-06-25T08:00:00.000Z"],
      [3, "2026-06-25T06:00:00.000Z"],
    ]);
  });

  it("builds a realtime-query-friendly result object with a ranked shortlist", () => {
    const results = buildMeetingResults({
      allowedTimeRanges: ranges,
      participants,
      availabilityRecords: [
        {
          membershipId: "alice",
          cellKey: "2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z",
          response: "yes",
        },
        {
          membershipId: "alice",
          cellKey: "2026-06-25T07:30:00.000Z_2026-06-25T08:00:00.000Z",
          response: "yes",
        },
      ],
      granularityMinutes: 30,
      durationMinutes: 60,
      timeZone: "Europe/Berlin",
      generatedAt: 123,
      maxShortlist: 2,
      includeDetails: false,
    });

    expect(results).toMatchObject({
      generatedAt: 123,
      totalParticipantCount: 2,
      voteCount: 2,
      candidateCount: 3,
      detailsVisible: false,
    });
    expect(results.shortlist).toHaveLength(2);
    expect(results.shortlist[0].participantDetails).toBeUndefined();
  });
});

describe("result privacy", () => {
  it("allows admins to read details even when a participant is summary-only", () => {
    expect(
      canViewerReadDetailedResults({
        viewer: { ...participants[0], role: "admin" },
        participants: [{ ...participants[0], privacyMode: "summaryOnly" }],
        canAdminister: true,
      }),
    ).toBe(true);
  });

  it("hides details from non-admins when any active participant is summary-only", () => {
    expect(
      canViewerReadDetailedResults({
        viewer: participants[0],
        participants: [
          participants[0],
          { ...participants[1], privacyMode: "summaryOnly" },
        ],
        canAdminister: false,
      }),
    ).toBe(false);
  });

  it("hides details from anonymous public viewers", () => {
    expect(
      canViewerReadDetailedResults({
        viewer: null,
        participants,
        canAdminister: false,
      }),
    ).toBe(false);
  });

  it("hides details from non-admin viewers who are not active participants", () => {
    expect(
      canViewerReadDetailedResults({
        viewer: {
          membershipId: "outsider",
          role: "member",
          privacyMode: "detailed",
        },
        participants,
        canAdminister: false,
      }),
    ).toBe(false);
  });

  it("redacts participant details from candidates and shortlist", () => {
    const detailedResults: MeetingResults = {
      generatedAt: 123,
      timeZone: "Europe/Berlin",
      granularityMinutes: 30,
      durationMinutes: 60,
      totalParticipantCount: 1,
      voteCount: 1,
      candidateCount: 1,
      detailsVisible: true,
      candidates: [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T08:00:00.000Z",
          timeZone: "Europe/Berlin",
          coveredCellKeys: ["2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z"],
          availableParticipantCount: 1,
          unavailableParticipantCount: 0,
          totalParticipantCount: 1,
          reluctantVoteCount: 0,
          yesVoteCount: 1,
          scorePercent: 100,
          rank: 1,
          participantDetails: [
            {
              membershipId: "alice",
              displayName: "Alice",
              responses: ["yes"],
              reluctantCount: 0,
            },
          ],
        },
      ],
      shortlist: [
        {
          startUtc: "2026-06-25T07:00:00.000Z",
          endUtc: "2026-06-25T08:00:00.000Z",
          timeZone: "Europe/Berlin",
          coveredCellKeys: ["2026-06-25T07:00:00.000Z_2026-06-25T07:30:00.000Z"],
          availableParticipantCount: 1,
          unavailableParticipantCount: 0,
          totalParticipantCount: 1,
          reluctantVoteCount: 0,
          yesVoteCount: 1,
          scorePercent: 100,
          rank: 1,
          participantDetails: [
            {
              membershipId: "alice",
              displayName: "Alice",
              responses: ["yes"],
              reluctantCount: 0,
            },
          ],
        },
      ],
    };

    const redacted = redactMeetingResults(detailedResults);

    expect(redacted.detailsVisible).toBe(false);
    expect(redacted.candidates[0].participantDetails).toBeUndefined();
    expect(redacted.shortlist[0].participantDetails).toBeUndefined();
  });
});
