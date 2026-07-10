import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRANULARITY_MINUTES,
  assertAvailabilityCellAlignment,
  assertAvailabilityCellDuration,
  buildGeneratedMeetingSlug,
  getMembershipCapabilities,
  isSlotFullyCoveredByAllowedRanges,
  makeAvailabilityCellKey,
  normalizeFinalizedSlot,
  normalizeEmailAddress,
  normalizeMeetingSettings,
  normalizeMeetingTitle,
  normalizeParticipantDisplayName,
  slugifyMeetingTitle,
  transitionMeetingLifecycle,
} from "./model";

describe("meeting settings", () => {
  it("applies timezone-aware defaults", () => {
    expect(normalizeMeetingSettings()).toEqual({
      canonicalTimeZone: "UTC",
      granularityMinutes: DEFAULT_GRANULARITY_MINUTES,
      durationMinutes: 60,
      allowedTimeRanges: [],
    });
  });

  it("normalizes allowed ranges to canonical UTC instants", () => {
    const settings = normalizeMeetingSettings({
      canonicalTimeZone: "Europe/Berlin",
      granularityMinutes: 15,
      durationMinutes: 45,
      allowedTimeRanges: [
        {
          startUtc: "2026-06-24T09:00:00+02:00",
          endUtc: "2026-06-24T10:00:00+02:00",
          label: "Morning block",
        },
      ],
    });

    expect(settings.allowedTimeRanges).toEqual([
      {
        startUtc: "2026-06-24T07:00:00.000Z",
        endUtc: "2026-06-24T08:00:00.000Z",
        timeZone: "Europe/Berlin",
        label: "Morning block",
      },
    ]);
  });

  it("rejects invalid timezone, duration, and range settings", () => {
    expect(() => normalizeMeetingSettings({ canonicalTimeZone: "Berlin-ish" })).toThrow(
      /Invalid IANA time zone/u,
    );
    expect(() =>
      normalizeMeetingSettings({ granularityMinutes: 20, durationMinutes: 45 }),
    ).toThrow(/multiple of granularityMinutes/u);
    expect(() =>
      normalizeMeetingSettings({
        allowedTimeRanges: [
          {
            startUtc: "2026-06-24T09:00:00Z",
            endUtc: "2026-06-24T08:00:00Z",
          },
        ],
      }),
    ).toThrow(/endUtc must be after startUtc/u);
    expect(() =>
      normalizeMeetingSettings({
        granularityMinutes: 30,
        durationMinutes: 90,
        allowedTimeRanges: [
          {
            startUtc: "2026-06-24T09:00:00Z",
            endUtc: "2026-06-24T10:00:00Z",
          },
        ],
      }),
    ).toThrow(/at least as long/u);
    expect(() =>
      normalizeMeetingSettings({
        granularityMinutes: 30,
        durationMinutes: 60,
        allowedTimeRanges: [
          {
            startUtc: "2026-06-24T09:07:00Z",
            endUtc: "2026-06-24T10:07:00Z",
          },
        ],
      }),
    ).toThrow(/boundaries must align/u);
  });

  it("bounds calendar work before candidate generation", () => {
    expect(() =>
      normalizeMeetingSettings({
        granularityMinutes: 5,
        durationMinutes: 245,
      }),
    ).toThrow(/at most 48 cells/u);

    expect(() =>
      normalizeMeetingSettings({
        granularityMinutes: 30,
        durationMinutes: 60,
        allowedTimeRanges: [
          {
            startUtc: "2026-06-01T00:00:00Z",
            endUtc: "2026-07-14T00:00:00Z",
          },
        ],
      }),
    ).toThrow(/within 42 days/u);

    expect(() =>
      normalizeMeetingSettings({
        granularityMinutes: 5,
        durationMinutes: 60,
        allowedTimeRanges: [
          {
            startUtc: "2026-06-01T00:00:00Z",
            endUtc: "2026-06-03T00:00:00Z",
          },
        ],
      }),
    ).toThrow(/at most 500 cells/u);
  });
});

describe("permission helpers", () => {
  it("lets role admins administer and finalize open meetings", () => {
    expect(
      getMembershipCapabilities(
        { lifecycleState: "open", adminMode: "roleBased" },
        { role: "admin" },
      ),
    ).toMatchObject({
      canAdminister: true,
      canEditAvailability: true,
      canFinalize: true,
      canReopen: false,
    });
  });

  it("keeps regular members out of admin actions unless everyone-admin is enabled", () => {
    expect(
      getMembershipCapabilities(
        { lifecycleState: "open", adminMode: "roleBased" },
        { role: "member" },
      ).canAdminister,
    ).toBe(false);

    expect(
      getMembershipCapabilities(
        { lifecycleState: "open", adminMode: "everyoneAdmin" },
        { role: "member" },
      ).canAdminister,
    ).toBe(true);
  });

  it("makes finalized meetings read-only until an admin reopens them", () => {
    const finalizedCapabilities = getMembershipCapabilities(
      { lifecycleState: "finalized", adminMode: "roleBased" },
      { role: "admin" },
    );

    expect(finalizedCapabilities).toMatchObject({
      canAdminister: true,
      canEditAvailability: false,
      canFinalize: false,
      canReopen: true,
    });
  });

  it("treats revoked memberships as unauthorized", () => {
    const capabilities = getMembershipCapabilities(
      { lifecycleState: "open", adminMode: "everyoneAdmin" },
      { role: "admin", revokedAt: Date.now() },
    );

    expect(capabilities).toEqual({
      canAdminister: false,
      canEditAvailability: false,
      canFinalize: false,
      canReopen: false,
      canReadDetailedAvailability: false,
    });
  });
});

describe("lifecycle transitions", () => {
  it("supports open to finalized to open again", () => {
    const admin = { role: "admin" as const };

    expect(
      transitionMeetingLifecycle(
        { lifecycleState: "open", adminMode: "roleBased" },
        admin,
        "finalize",
      ),
    ).toBe("finalized");

    expect(
      transitionMeetingLifecycle(
        { lifecycleState: "finalized", adminMode: "roleBased" },
        admin,
        "reopen",
      ),
    ).toBe("open");
  });

  it("rejects invalid lifecycle transitions", () => {
    expect(() =>
      transitionMeetingLifecycle(
        { lifecycleState: "finalized", adminMode: "roleBased" },
        { role: "admin" },
        "finalize",
      ),
    ).toThrow(/Only an active admin can finalize/u);

    expect(() =>
      transitionMeetingLifecycle(
        { lifecycleState: "open", adminMode: "roleBased" },
        { role: "member" },
        "reopen",
      ),
    ).toThrow(/Only an active admin can reopen/u);
  });
});

describe("schema-adjacent helpers", () => {
  it("builds stable cell keys and enforces granularity alignment", () => {
    expect(
      makeAvailabilityCellKey("2026-06-24T09:00:00+02:00", "2026-06-24T09:30:00+02:00"),
    ).toBe("2026-06-24T07:00:00.000Z_2026-06-24T07:30:00.000Z");

    expect(() =>
      assertAvailabilityCellAlignment(
        "2026-06-24T07:00:00.000Z",
        "2026-06-24T07:45:00.000Z",
        30,
      ),
    ).toThrow(/align/u);

    expect(() =>
      assertAvailabilityCellAlignment(
        "2026-06-24T07:07:00.000Z",
        "2026-06-24T07:37:00.000Z",
        30,
      ),
    ).toThrow(/boundaries must align/u);

    expect(() =>
      makeAvailabilityCellKey("2026-06-24T07:00:00", "2026-06-24T07:30:00Z"),
    ).toThrow(/explicit timezone offset/u);
  });

  it("requires persisted availability records to cover one grid cell", () => {
    expect(() =>
      assertAvailabilityCellDuration(
        "2026-06-24T07:00:00.000Z",
        "2026-06-24T07:30:00.000Z",
        30,
      ),
    ).not.toThrow();

    expect(() =>
      assertAvailabilityCellDuration(
        "2026-06-24T07:00:00.000Z",
        "2026-06-24T08:00:00.000Z",
        30,
      ),
    ).toThrow(/exactly one meeting grid cell/u);
  });

  it("aligns availability cells to the meeting wall-clock timezone", () => {
    expect(() =>
      assertAvailabilityCellAlignment(
        "2026-06-23T18:15:00Z",
        "2026-06-23T18:45:00Z",
        30,
        "Asia/Kathmandu",
      ),
    ).not.toThrow();

    expect(() =>
      assertAvailabilityCellAlignment("2026-06-23T18:15:00Z", "2026-06-23T18:45:00Z", 30),
    ).toThrow(/boundaries must align/u);
  });

  it("normalizes and validates finalized slots", () => {
    const meeting = {
      canonicalTimeZone: "Europe/Berlin",
      durationMinutes: 60,
      granularityMinutes: 30,
      allowedTimeRanges: [
        {
          startUtc: "2026-06-24T07:00:00.000Z",
          endUtc: "2026-06-24T10:00:00.000Z",
          timeZone: "Europe/Berlin",
        },
      ],
    };

    expect(
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-24T09:00:00+02:00",
          endUtc: "2026-06-24T10:00:00+02:00",
        },
        meeting,
      ),
    ).toEqual({
      startUtc: "2026-06-24T07:00:00.000Z",
      endUtc: "2026-06-24T08:00:00.000Z",
      timeZone: "Europe/Berlin",
    });

    expect(() =>
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-24T12:00:00+02:00",
          endUtc: "2026-06-24T13:00:00+02:00",
        },
        meeting,
      ),
    ).toThrow(/fully covered by allowed time ranges/u);
  });

  it("allows final slots to span adjacent allowed cells", () => {
    const meeting = {
      canonicalTimeZone: "Europe/Berlin",
      durationMinutes: 60,
      granularityMinutes: 30,
      allowedTimeRanges: [
        {
          startUtc: "2026-06-24T07:00:00.000Z",
          endUtc: "2026-06-24T07:30:00.000Z",
          timeZone: "Europe/Berlin",
        },
        {
          startUtc: "2026-06-24T07:30:00.000Z",
          endUtc: "2026-06-24T08:00:00.000Z",
          timeZone: "Europe/Berlin",
        },
      ],
    };

    expect(
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-24T09:00:00+02:00",
          endUtc: "2026-06-24T10:00:00+02:00",
        },
        meeting,
      ),
    ).toMatchObject({
      startUtc: "2026-06-24T07:00:00.000Z",
      endUtc: "2026-06-24T08:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
  });

  it("rejects stale final slots with gaps in the current allowed cells", () => {
    const allowedTimeRanges = [
      {
        startUtc: "2026-06-24T07:00:00.000Z",
        endUtc: "2026-06-24T07:30:00.000Z",
        timeZone: "Europe/Berlin",
      },
      {
        startUtc: "2026-06-24T08:00:00.000Z",
        endUtc: "2026-06-24T08:30:00.000Z",
        timeZone: "Europe/Berlin",
      },
    ];

    expect(
      isSlotFullyCoveredByAllowedRanges(
        {
          startUtc: "2026-06-24T07:00:00.000Z",
          endUtc: "2026-06-24T08:00:00.000Z",
        },
        allowedTimeRanges,
        30,
      ),
    ).toBe(false);
    expect(() =>
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-24T09:00:00+02:00",
          endUtc: "2026-06-24T10:00:00+02:00",
        },
        {
          canonicalTimeZone: "Europe/Berlin",
          durationMinutes: 60,
          granularityMinutes: 30,
          allowedTimeRanges,
        },
      ),
    ).toThrow(/fully covered/u);
  });

  it("requires finalized slots to use the meeting timezone and local grid", () => {
    const meeting = {
      canonicalTimeZone: "Asia/Kathmandu",
      durationMinutes: 30,
      granularityMinutes: 15,
      allowedTimeRanges: [
        {
          startUtc: "2026-06-23T18:15:00.000Z",
          endUtc: "2026-06-23T19:00:00.000Z",
          timeZone: "Asia/Kathmandu",
        },
      ],
    };

    expect(() =>
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-23T18:15:00.000Z",
          endUtc: "2026-06-23T18:45:00.000Z",
          timeZone: "UTC",
        },
        meeting,
      ),
    ).toThrow(/timezone must match/u);

    expect(() =>
      normalizeFinalizedSlot(
        {
          startUtc: "2026-06-23T18:15:00.000Z",
          endUtc: "2026-06-23T18:45:00.000Z",
        },
        meeting,
      ),
    ).not.toThrow();
  });

  it("normalizes slugs and email identities", () => {
    expect(normalizeMeetingTitle("  Team Planning  ")).toBe("Team Planning");
    expect(() => normalizeMeetingTitle("   ")).toThrow(/title is required/u);
    expect(() => normalizeMeetingTitle("A".repeat(161))).toThrow(
      /160 characters or fewer/u,
    );
    expect(normalizeParticipantDisplayName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(() => normalizeParticipantDisplayName("   ")).toThrow(
      /display name is required/u,
    );
    expect(() => normalizeParticipantDisplayName("A".repeat(121))).toThrow(
      /120 characters or fewer/u,
    );
    expect(slugifyMeetingTitle("  Team Planning / Q3!  ")).toBe("team-planning-q3");
    expect(
      buildGeneratedMeetingSlug({
        title: "  Team Planning / Q3!  ",
        tokenFingerprint: "FLUOTf_ab-123",
      }),
    ).toBe("team-planning-q3-fluotf");
    expect(normalizeEmailAddress("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(() => normalizeEmailAddress("not-email")).toThrow(
      /Email address must be valid/u,
    );
  });
});
