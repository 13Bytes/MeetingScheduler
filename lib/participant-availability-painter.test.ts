import { describe, expect, it } from "vitest";
import {
  availabilityPaintReducer,
  availabilityRecordsToResponseMap,
  availabilityStateToSaveRequests,
  buildParticipantAvailabilityGrid,
  createInitialAvailabilityPaintState,
  summarizeAvailability,
} from "@/lib/participant-availability-painter";

const berlinRanges = [
  {
    startUtc: "2026-06-25T07:00:00.000Z",
    endUtc: "2026-06-25T09:00:00.000Z",
    timeZone: "Europe/Berlin",
  },
];

function buildGrid() {
  return buildParticipantAvailabilityGrid({
    timeZone: "Europe/Berlin",
    granularityMinutes: 30,
    durationMinutes: 60,
    allowedTimeRanges: berlinRanges,
    baseDate: new Date("2026-06-25T06:00:00.000Z"),
    minDays: 1,
    maxDays: 1,
  });
}

describe("participant availability grid", () => {
  it("limits participant cells to admin-allowed ranges in the meeting timezone", () => {
    const grid = buildGrid();

    expect(grid.participantCells).toHaveLength(4);
    expect(
      grid.participantCellKeys.has(grid.cellsByDateTime.get("2026-06-25_09:00")!.key),
    ).toBe(true);
    expect(
      grid.participantCellKeys.has(grid.cellsByDateTime.get("2026-06-25_11:00")!.key),
    ).toBe(false);
  });
});

describe("participant paint reducer", () => {
  it("paints yes, reluctant, no, and clear responses", () => {
    const grid = buildGrid();
    const nine = grid.cellsByDateTime.get("2026-06-25_09:00")!;
    const nineThirty = grid.cellsByDateTime.get("2026-06-25_09:30")!;
    let state = createInitialAvailabilityPaintState();

    state = availabilityPaintReducer(state, {
      type: "begin",
      cellKey: nine.key,
      mode: "yes",
    });
    state = availabilityPaintReducer(state, {
      type: "hover",
      cellKey: nineThirty.key,
      grid,
    });
    state = availabilityPaintReducer(state, { type: "commit" });

    expect(state.responsesByCellKey.get(nine.key)).toBe("yes");
    expect(state.responsesByCellKey.get(nineThirty.key)).toBe("yes");

    state = availabilityPaintReducer(state, {
      type: "apply",
      cellKeys: [nine.key],
      mode: "reluctant",
    });
    expect(state.responsesByCellKey.get(nine.key)).toBe("reluctant");

    state = availabilityPaintReducer(state, {
      type: "apply",
      cellKeys: [nineThirty.key],
      mode: "no",
    });
    expect(state.responsesByCellKey.get(nineThirty.key)).toBe("no");

    state = availabilityPaintReducer(state, {
      type: "apply",
      cellKeys: [nine.key],
      mode: "clear",
    });
    expect(state.responsesByCellKey.has(nine.key)).toBe(false);
  });

  it("drag previews never include cells outside the admin-allowed region", () => {
    const grid = buildGrid();
    const nine = grid.cellsByDateTime.get("2026-06-25_09:00")!;
    const noon = grid.cellsByDateTime.get("2026-06-25_12:00")!;
    let state = createInitialAvailabilityPaintState();

    state = availabilityPaintReducer(state, {
      type: "begin",
      cellKey: nine.key,
      mode: "yes",
    });
    state = availabilityPaintReducer(state, {
      type: "hover",
      cellKey: noon.key,
      grid,
    });

    expect(state.previewCellKeys).toEqual(grid.participantCellKeys);
  });
});

describe("participant availability conversion", () => {
  it("converts changed responses and clears to availability record requests", () => {
    const grid = buildGrid();
    const nine = grid.cellsByDateTime.get("2026-06-25_09:00")!;
    const nineThirty = grid.cellsByDateTime.get("2026-06-25_09:30")!;
    const original = new Map([
      [nine.key, "yes" as const],
      [nineThirty.key, "reluctant" as const],
    ]);
    const next = new Map([[nine.key, "no" as const]]);

    expect(
      availabilityStateToSaveRequests({
        grid,
        responsesByCellKey: next,
        originalResponsesByCellKey: original,
      }),
    ).toEqual([
      {
        startUtc: "2026-06-25T07:00:00.000Z",
        endUtc: "2026-06-25T07:30:00.000Z",
        timeZone: "Europe/Berlin",
        response: "no",
      },
      {
        startUtc: "2026-06-25T07:30:00.000Z",
        endUtc: "2026-06-25T08:00:00.000Z",
        timeZone: "Europe/Berlin",
      },
    ]);
  });

  it("hydrates persisted own records and summarizes unset cells", () => {
    const grid = buildGrid();
    const nine = grid.cellsByDateTime.get("2026-06-25_09:00")!;
    const outside = grid.cellsByDateTime.get("2026-06-25_12:00")!;
    const responses = availabilityRecordsToResponseMap(
      [
        { ...nine, cellKey: nine.key, timeZone: "Europe/Berlin", response: "yes" },
        { ...outside, cellKey: outside.key, timeZone: "Europe/Berlin", response: "no" },
      ],
      grid.participantCellKeys,
    );

    expect(responses.size).toBe(1);
    expect(summarizeAvailability(grid, responses)).toEqual({
      yes: 1,
      reluctant: 0,
      no: 0,
      clear: 3,
    });
  });
});
