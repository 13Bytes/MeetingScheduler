import {
  buildCalendarGrid,
  rangesToAllowedCellKeys,
  type CalendarGrid,
  type CalendarGridCell,
  type CalendarGridInput,
} from "@/lib/admin-calendar-painter";

export type AvailabilityResponse = "yes" | "reluctant" | "no";
export type ParticipantPaintMode = AvailabilityResponse | "clear";

export type ParticipantAvailabilityGrid = CalendarGrid & {
  participantCellKeys: Set<string>;
  participantCells: CalendarGridCell[];
};

export type AvailabilityPaintState = {
  responsesByCellKey: Map<string, AvailabilityResponse>;
  previewCellKeys: Set<string>;
  anchorCellKey: string | null;
  activeMode: ParticipantPaintMode;
};

export type AvailabilityPaintAction =
  | { type: "begin"; cellKey: string; mode: ParticipantPaintMode }
  | { type: "hover"; cellKey: string; grid: ParticipantAvailabilityGrid }
  | {
      type: "applyRange";
      anchorCellKey: string;
      targetCellKey: string;
      grid: ParticipantAvailabilityGrid;
      mode: ParticipantPaintMode;
    }
  | { type: "commit" }
  | { type: "cancel" }
  | { type: "replace"; responsesByCellKey: Iterable<[string, AvailabilityResponse]> }
  | {
      type: "apply";
      cellKeys: Iterable<string>;
      mode: ParticipantPaintMode;
    };

export type AvailabilityRecordInput = {
  startUtc: string;
  endUtc: string;
  timeZone: string;
  response?: AvailabilityResponse;
};

export type PersistedAvailabilityRecord = {
  cellKey: string;
  startUtc: string;
  endUtc: string;
  timeZone: string;
  response: AvailabilityResponse;
};

export function buildParticipantAvailabilityGrid(
  input: CalendarGridInput,
): ParticipantAvailabilityGrid {
  const grid = buildCalendarGrid(input);
  const participantCellKeys = rangesToAllowedCellKeys(grid, input.allowedTimeRanges);
  return {
    ...grid,
    participantCellKeys,
    participantCells: grid.orderedCells.filter((cell) =>
      participantCellKeys.has(cell.key),
    ),
  };
}

export function createInitialAvailabilityPaintState(
  responsesByCellKey: Iterable<[string, AvailabilityResponse]> = [],
): AvailabilityPaintState {
  return {
    responsesByCellKey: new Map(responsesByCellKey),
    previewCellKeys: new Set(),
    anchorCellKey: null,
    activeMode: "yes",
  };
}

export function availabilityPaintReducer(
  state: AvailabilityPaintState,
  action: AvailabilityPaintAction,
): AvailabilityPaintState {
  if (action.type === "replace") {
    return createInitialAvailabilityPaintState(action.responsesByCellKey);
  }

  if (action.type === "begin") {
    return {
      ...state,
      activeMode: action.mode,
      anchorCellKey: action.cellKey,
      previewCellKeys: new Set([action.cellKey]),
    };
  }

  if (action.type === "hover") {
    if (!state.anchorCellKey) {
      return state;
    }
    return {
      ...state,
      previewCellKeys: getParticipantCellKeysInRectangle(
        action.grid,
        state.anchorCellKey,
        action.cellKey,
      ),
    };
  }

  if (action.type === "cancel") {
    return { ...state, previewCellKeys: new Set(), anchorCellKey: null };
  }

  if (action.type === "apply") {
    return applyPaintMode(state, action.cellKeys, action.mode);
  }

  if (action.type === "applyRange") {
    return applyPaintMode(
      state,
      getParticipantCellKeysInRectangle(
        action.grid,
        action.anchorCellKey,
        action.targetCellKey,
      ),
      action.mode,
    );
  }

  return applyPaintMode(state, state.previewCellKeys, state.activeMode);
}

export function availabilityRecordsToResponseMap(
  records: PersistedAvailabilityRecord[],
  allowedCellKeys?: Set<string>,
) {
  const responses = new Map<string, AvailabilityResponse>();
  for (const record of records) {
    if (!allowedCellKeys || allowedCellKeys.has(record.cellKey)) {
      responses.set(record.cellKey, record.response);
    }
  }
  return responses;
}

export function availabilityStateToSaveRequests({
  grid,
  responsesByCellKey,
  originalResponsesByCellKey = new Map(),
}: {
  grid: ParticipantAvailabilityGrid;
  responsesByCellKey: Map<string, AvailabilityResponse>;
  originalResponsesByCellKey?: Map<string, AvailabilityResponse>;
}): AvailabilityRecordInput[] {
  const changedRequests: AvailabilityRecordInput[] = [];
  const keys = new Set([
    ...Array.from(responsesByCellKey.keys()),
    ...Array.from(originalResponsesByCellKey.keys()),
  ]);

  for (const cellKey of keys) {
    if (!grid.participantCellKeys.has(cellKey)) {
      continue;
    }
    const nextResponse = responsesByCellKey.get(cellKey);
    const originalResponse = originalResponsesByCellKey.get(cellKey);
    if (nextResponse === originalResponse) {
      continue;
    }
    const cell = grid.cellsByKey.get(cellKey);
    if (!cell) {
      continue;
    }
    changedRequests.push({
      startUtc: cell.startUtc,
      endUtc: cell.endUtc,
      timeZone: grid.timeZone,
      ...(nextResponse ? { response: nextResponse } : {}),
    });
  }

  return changedRequests.sort(
    (left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc),
  );
}

export function summarizeAvailability(
  grid: ParticipantAvailabilityGrid,
  responsesByCellKey: Map<string, AvailabilityResponse>,
) {
  const counts = {
    yes: 0,
    reluctant: 0,
    no: 0,
    clear: 0,
  };

  for (const cellKey of grid.participantCellKeys) {
    const response = responsesByCellKey.get(cellKey);
    if (response) {
      counts[response] += 1;
    } else {
      counts.clear += 1;
    }
  }

  return counts;
}

function applyPaintMode(
  state: AvailabilityPaintState,
  cellKeys: Iterable<string>,
  mode: ParticipantPaintMode,
): AvailabilityPaintState {
  const responsesByCellKey = new Map(state.responsesByCellKey);
  for (const cellKey of cellKeys) {
    if (mode === "clear") {
      responsesByCellKey.delete(cellKey);
    } else {
      responsesByCellKey.set(cellKey, mode);
    }
  }
  return {
    ...state,
    responsesByCellKey,
    previewCellKeys: new Set(),
    anchorCellKey: null,
  };
}

function getParticipantCellKeysInRectangle(
  grid: ParticipantAvailabilityGrid,
  anchorCellKey: string,
  targetCellKey: string,
) {
  const anchor = grid.cellsByKey.get(anchorCellKey);
  const target = grid.cellsByKey.get(targetCellKey);
  if (!anchor || !target) {
    return new Set<string>();
  }

  const dayIndexes = new Map(grid.days.map((day, index) => [day.dateKey, index]));
  const timeIndexes = new Map(grid.timeKeys.map((timeKey, index) => [timeKey, index]));
  const startDayIndex = Math.min(
    dayIndexes.get(anchor.dateKey) ?? 0,
    dayIndexes.get(target.dateKey) ?? 0,
  );
  const endDayIndex = Math.max(
    dayIndexes.get(anchor.dateKey) ?? 0,
    dayIndexes.get(target.dateKey) ?? 0,
  );
  const startTimeIndex = Math.min(
    timeIndexes.get(anchor.timeKey) ?? 0,
    timeIndexes.get(target.timeKey) ?? 0,
  );
  const endTimeIndex = Math.max(
    timeIndexes.get(anchor.timeKey) ?? 0,
    timeIndexes.get(target.timeKey) ?? 0,
  );
  const keys = new Set<string>();

  for (let timeIndex = startTimeIndex; timeIndex <= endTimeIndex; timeIndex += 1) {
    for (let dayIndex = startDayIndex; dayIndex <= endDayIndex; dayIndex += 1) {
      const cell = grid.cellsByDateTime.get(
        `${grid.days[dayIndex].dateKey}_${grid.timeKeys[timeIndex]}`,
      );
      if (cell && grid.participantCellKeys.has(cell.key)) {
        keys.add(cell.key);
      }
    }
  }

  return keys;
}
