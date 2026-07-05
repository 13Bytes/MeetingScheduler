import { describe, expect, it } from "vitest";
import {
  parseAvailabilityBody,
  parseCreateApiTokenBody,
  parseCreateMeetingBody,
} from "./schemas";

describe("agent API schemas", () => {
  it("rejects unsupported token scopes", () => {
    expect(() =>
      parseCreateApiTokenBody({ scopes: ["meetings:create", "admin:*"] }),
    ).toThrow(/not a supported API scope/u);
  });

  it("requires allowed ranges for meeting creation", () => {
    expect(() =>
      parseCreateMeetingBody({
        title: "Research Sync",
        settings: { allowedTimeRanges: [] },
      }),
    ).toThrow(/at least one range/u);
  });

  it("accepts omitted availability response as an explicit cell clear", () => {
    expect(
      parseAvailabilityBody({
        records: [
          {
            startUtc: "2026-07-06T09:00:00.000Z",
            endUtc: "2026-07-06T09:30:00.000Z",
          },
        ],
      }),
    ).toEqual({
      records: [
        {
          startUtc: "2026-07-06T09:00:00.000Z",
          endUtc: "2026-07-06T09:30:00.000Z",
          note: undefined,
          response: undefined,
          timeZone: undefined,
        },
      ],
    });
  });

  it("rejects unknown availability responses", () => {
    expect(() =>
      parseAvailabilityBody({
        records: [
          {
            startUtc: "2026-07-06T09:00:00.000Z",
            endUtc: "2026-07-06T09:30:00.000Z",
            response: "maybe",
          },
        ],
      }),
    ).toThrow(/response must be yes/u);
  });
});
