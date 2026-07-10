import { MAX_ALLOWED_CELLS } from "./model";

export type ResultAvailabilityResponse = "yes" | "reluctant" | "no";
export type ResultPrivacyMode = "detailed" | "summaryOnly";

export type ResultAllowedTimeRange = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
  label?: string;
};

export type ResultParticipant = {
  membershipId: string;
  displayName?: string;
  role: "admin" | "member";
  privacyMode: ResultPrivacyMode;
  revokedAt?: number;
};

export type ResultAvailabilityRecord = {
  membershipId: string;
  cellKey: string;
  response: ResultAvailabilityResponse;
};

export type CandidateSlot = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
  coveredCellKeys: string[];
};

export type CandidateParticipantDetail = {
  membershipId: string;
  displayName?: string;
  responses: ResultAvailabilityResponse[];
  reluctantCount: number;
};

export type ResultVotedParticipant = {
  membershipId: string;
  displayName?: string;
};

export type ScoredCandidateSlot = CandidateSlot & {
  availableParticipantCount: number;
  unavailableParticipantCount: number;
  totalParticipantCount: number;
  reluctantVoteCount: number;
  yesVoteCount: number;
  scorePercent: number;
  rank: number;
  participantDetails?: CandidateParticipantDetail[];
};

export type MeetingResults = {
  generatedAt: number;
  timeZone: string;
  granularityMinutes: number;
  durationMinutes: number;
  totalParticipantCount: number;
  votedParticipantCount: number;
  availabilityCount: number;
  candidateCount: number;
  detailsVisible: boolean;
  candidates: ScoredCandidateSlot[];
  shortlist: ScoredCandidateSlot[];
  votedParticipants?: ResultVotedParticipant[];
};

export type MeetingResultsInput = {
  allowedTimeRanges: ResultAllowedTimeRange[];
  participants: ResultParticipant[];
  availabilityRecords: ResultAvailabilityRecord[];
  granularityMinutes: number;
  durationMinutes: number;
  timeZone: string;
  generatedAt?: number;
  maxShortlist?: number;
  includeDetails?: boolean;
};

export const MAX_RESULT_CANDIDATES = MAX_ALLOWED_CELLS;

export function generateCandidateSlots({
  allowedTimeRanges,
  granularityMinutes,
  durationMinutes,
  timeZone,
}: {
  allowedTimeRanges: ResultAllowedTimeRange[];
  granularityMinutes: number;
  durationMinutes: number;
  timeZone: string;
}): CandidateSlot[] {
  assertCandidateSettings(granularityMinutes, durationMinutes);
  const granularityMs = granularityMinutes * minuteMs;
  const durationMs = durationMinutes * minuteMs;
  const cells = generateAllowedCells(allowedTimeRanges, granularityMinutes);
  if (cells.length > MAX_RESULT_CANDIDATES) {
    throw new Error(`Meeting results support at most ${MAX_RESULT_CANDIDATES} cells`);
  }
  const allowedCellKeys = new Set(cells.map((cell) => cell.key));
  const starts = new Set(cells.map((cell) => cell.startUtc));
  const candidates: CandidateSlot[] = [];

  for (const startUtc of Array.from(starts).sort(compareIsoInstants)) {
    const startMs = Date.parse(startUtc);
    const endUtc = new Date(startMs + durationMs).toISOString();
    const coveredCellKeys: string[] = [];
    let isFullyAllowed = true;

    for (
      let cellStartMs = startMs;
      cellStartMs < startMs + durationMs;
      cellStartMs += granularityMs
    ) {
      const cellEndMs = cellStartMs + granularityMs;
      const cellKey = makeResultCellKey(
        new Date(cellStartMs).toISOString(),
        new Date(cellEndMs).toISOString(),
      );
      if (!allowedCellKeys.has(cellKey)) {
        isFullyAllowed = false;
        break;
      }
      coveredCellKeys.push(cellKey);
    }

    if (isFullyAllowed) {
      candidates.push({
        startUtc,
        endUtc,
        timeZone,
        coveredCellKeys,
      });
    }
  }

  return candidates;
}

export function buildMeetingResults({
  allowedTimeRanges,
  participants,
  availabilityRecords,
  granularityMinutes,
  durationMinutes,
  timeZone,
  generatedAt = Date.now(),
  maxShortlist = 5,
  includeDetails = false,
}: MeetingResultsInput): MeetingResults {
  const activeParticipants = participants.filter(
    (participant) => participant.revokedAt === undefined,
  );
  const activeMembershipIds = new Set(
    activeParticipants.map((participant) => participant.membershipId),
  );
  const availabilityCount = availabilityRecords.filter((record) =>
    activeMembershipIds.has(record.membershipId),
  ).length;
  const votedMembershipIds = new Set(
    availabilityRecords
      .filter((record) => activeMembershipIds.has(record.membershipId))
      .map((record) => record.membershipId),
  );
  const votedParticipants = activeParticipants.filter((participant) =>
    votedMembershipIds.has(participant.membershipId),
  );
  const candidates = generateCandidateSlots({
    allowedTimeRanges,
    granularityMinutes,
    durationMinutes,
    timeZone,
  });
  const responsesByMembership = buildResponsesByMembership(availabilityRecords);
  const scoredCandidates = rankScoredCandidates(
    candidates.map((candidate) =>
      scoreCandidate(candidate, activeParticipants, responsesByMembership, false),
    ),
  );
  const shortlist = scoredCandidates
    .filter((candidate) => candidate.availableParticipantCount > 0)
    .slice(0, maxShortlist)
    .map((candidate) => {
      if (!includeDetails) {
        return candidate;
      }
      const detailed = scoreCandidate(
        candidate,
        activeParticipants,
        responsesByMembership,
        true,
      );
      return { ...candidate, participantDetails: detailed.participantDetails };
    });

  return {
    generatedAt,
    timeZone,
    granularityMinutes,
    durationMinutes,
    totalParticipantCount: activeParticipants.length,
    votedParticipantCount: votedParticipants.length,
    availabilityCount,
    candidateCount: scoredCandidates.length,
    detailsVisible: includeDetails,
    candidates: scoredCandidates,
    shortlist,
    ...(includeDetails
      ? {
          votedParticipants: votedParticipants.map((participant) => ({
            membershipId: participant.membershipId,
            displayName: participant.displayName,
          })),
        }
      : {}),
  };
}

export function scoreCandidate(
  candidate: CandidateSlot,
  participants: ResultParticipant[],
  responsesByMembership: Map<string, Map<string, ResultAvailabilityResponse>>,
  includeDetails = false,
): Omit<ScoredCandidateSlot, "rank"> {
  let availableParticipantCount = 0;
  let reluctantVoteCount = 0;
  let yesVoteCount = 0;
  const participantDetails: CandidateParticipantDetail[] = [];

  for (const participant of participants) {
    const responsesByCell = responsesByMembership.get(participant.membershipId);
    const responses = candidate.coveredCellKeys.map((cellKey) =>
      responsesByCell?.get(cellKey),
    );
    const canAttend = responses.every(
      (response): response is "yes" | "reluctant" =>
        response === "yes" || response === "reluctant",
    );

    if (!canAttend) {
      continue;
    }

    const reluctantCount = responses.filter(
      (response) => response === "reluctant",
    ).length;
    const participantYesCount = responses.filter((response) => response === "yes").length;
    availableParticipantCount += 1;
    reluctantVoteCount += reluctantCount;
    yesVoteCount += participantYesCount;

    if (includeDetails) {
      participantDetails.push({
        membershipId: participant.membershipId,
        displayName: participant.displayName,
        responses,
        reluctantCount,
      });
    }
  }

  const totalParticipantCount = participants.length;
  return {
    ...candidate,
    availableParticipantCount,
    unavailableParticipantCount: totalParticipantCount - availableParticipantCount,
    totalParticipantCount,
    reluctantVoteCount,
    yesVoteCount,
    scorePercent:
      totalParticipantCount === 0
        ? 0
        : Math.round((availableParticipantCount / totalParticipantCount) * 100),
    ...(includeDetails ? { participantDetails } : {}),
  };
}

export function rankScoredCandidates(
  candidates: Omit<ScoredCandidateSlot, "rank">[],
): ScoredCandidateSlot[] {
  return [...candidates]
    .sort((left, right) => {
      if (left.availableParticipantCount !== right.availableParticipantCount) {
        return right.availableParticipantCount - left.availableParticipantCount;
      }
      if (left.reluctantVoteCount !== right.reluctantVoteCount) {
        return left.reluctantVoteCount - right.reluctantVoteCount;
      }
      return compareIsoInstants(left.startUtc, right.startUtc);
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}

export function canViewerReadDetailedResults({
  viewer,
  participants,
  canAdminister,
}: {
  viewer?: ResultParticipant | null;
  participants: ResultParticipant[];
  canAdminister: boolean;
}) {
  if (canAdminister) {
    return true;
  }
  const activeParticipants = participants.filter(
    (participant) => participant.revokedAt === undefined,
  );
  const activeViewer = viewer
    ? activeParticipants.find(
        (participant) => participant.membershipId === viewer.membershipId,
      )
    : null;
  if (!activeViewer || activeViewer.privacyMode !== "detailed") {
    return false;
  }
  return activeParticipants.every(
    (participant) => participant.privacyMode === "detailed",
  );
}

export function redactMeetingResults(results: MeetingResults): MeetingResults {
  if (!results.detailsVisible) {
    return results;
  }

  const redactCandidate = (candidate: ScoredCandidateSlot): ScoredCandidateSlot => {
    const summary = { ...candidate };
    delete summary.participantDetails;
    return summary;
  };
  const summaryResults = { ...results };
  delete summaryResults.votedParticipants;

  return {
    ...summaryResults,
    detailsVisible: false,
    candidates: results.candidates.map(redactCandidate),
    shortlist: results.shortlist.map(redactCandidate),
  };
}

export function makeResultCellKey(startUtc: string, endUtc: string): string {
  return `${normalizeIsoInstant(startUtc)}_${normalizeIsoInstant(endUtc)}`;
}

function generateAllowedCells(
  allowedTimeRanges: ResultAllowedTimeRange[],
  granularityMinutes: number,
) {
  const granularityMs = granularityMinutes * minuteMs;
  const cellsByKey = new Map<string, { key: string; startUtc: string; endUtc: string }>();

  for (const range of allowedTimeRanges) {
    const startMs = Date.parse(normalizeIsoInstant(range.startUtc));
    const endMs = Date.parse(normalizeIsoInstant(range.endUtc));
    for (
      let cellStartMs = startMs;
      cellStartMs + granularityMs <= endMs;
      cellStartMs += granularityMs
    ) {
      const startUtc = new Date(cellStartMs).toISOString();
      const endUtc = new Date(cellStartMs + granularityMs).toISOString();
      const key = makeResultCellKey(startUtc, endUtc);
      cellsByKey.set(key, { key, startUtc, endUtc });
    }
  }

  return Array.from(cellsByKey.values()).sort((left, right) =>
    compareIsoInstants(left.startUtc, right.startUtc),
  );
}

function buildResponsesByMembership(records: ResultAvailabilityRecord[]) {
  const responsesByMembership = new Map<
    string,
    Map<string, ResultAvailabilityResponse>
  >();
  for (const record of records) {
    const responsesByCell =
      responsesByMembership.get(record.membershipId) ??
      new Map<string, ResultAvailabilityResponse>();
    responsesByCell.set(record.cellKey, record.response);
    responsesByMembership.set(record.membershipId, responsesByCell);
  }
  return responsesByMembership;
}

function assertCandidateSettings(
  granularityMinutes: number,
  durationMinutes: number,
): void {
  if (!Number.isInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new Error("granularityMinutes must be a positive integer");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer");
  }
  if (durationMinutes % granularityMinutes !== 0) {
    throw new Error("durationMinutes must be a multiple of granularityMinutes");
  }
}

function normalizeIsoInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Expected a valid ISO instant");
  }
  return new Date(timestamp).toISOString();
}

function compareIsoInstants(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

const minuteMs = 60 * 1000;
