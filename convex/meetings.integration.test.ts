/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("meetings Convex integration", () => {
  it("rejects calendars that exceed the backend cell budget", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.meetings.createMeeting, {
        title: "Oversized calendar",
        settings: {
          granularityMinutes: 5,
          durationMinutes: 5,
          allowedTimeRanges: [
            {
              startUtc: "2026-07-01T00:00:00.000Z",
              endUtc: "2026-07-02T17:45:00.000Z",
            },
          ],
        },
      }),
    ).rejects.toThrow(/at most 500 cells/u);
  });

  it("redacts membership identifiers from public meeting reads", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.meetings.createMeeting, {
      title: "Public planning",
      settings: {
        allowedTimeRanges: [
          {
            startUtc: "2026-07-01T09:00:00.000Z",
            endUtc: "2026-07-01T12:00:00.000Z",
          },
        ],
      },
    });

    const result = await t.query(api.meetings.readPublicMeetingBySlug, {
      slug: created.slug,
    });
    expect(result?.meeting).not.toHaveProperty("createdByMembershipId");
    expect(result?.meeting).not.toHaveProperty("finalizedByMembershipId");
    expect(result?.meeting).not.toHaveProperty("reopenedByMembershipId");

    await expect(
      t.mutation(api.meetings.updateMeetingSettings, {
        membershipToken: created.adminMembershipToken,
        title: "   ",
      }),
    ).rejects.toThrow(/Meeting title is required/u);
  });

  it("rejects availability batches above the transaction-safe limit", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.meetings.createMeeting, {
      title: "Bounded responses",
      creatorName: "Admin",
      settings: {
        allowedTimeRanges: [
          {
            startUtc: "2026-07-01T09:00:00.000Z",
            endUtc: "2026-07-01T12:00:00.000Z",
          },
        ],
      },
    });
    const records = Array.from({ length: 501 }, (_, index) => ({
      startUtc: new Date(Date.UTC(2026, 6, 1, 9, index * 30)).toISOString(),
      endUtc: new Date(Date.UTC(2026, 6, 1, 9, (index + 1) * 30)).toISOString(),
      response: "yes" as const,
    }));

    await expect(
      t.mutation(api.meetings.saveAvailabilityRecords, {
        membershipToken: created.adminMembershipToken,
        records,
      }),
    ).rejects.toThrow(/at most 500 records/u);
  });
});
