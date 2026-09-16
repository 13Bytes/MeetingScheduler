// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { hashSecretToken } from "./domain/tokens";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const secret = "test-only-internal-secret-for-regression-tests";
const settings = {
  canonicalTimeZone: "UTC",
  granularityMinutes: 30,
  durationMinutes: 60,
  allowedTimeRanges: [
    { startUtc: "2026-09-20T09:00:00Z", endUtc: "2026-09-20T12:00:00Z" },
  ],
};
type Backend = ReturnType<typeof makeBackend>;
function makeBackend() {
  return convexTest(schema, modules);
}
async function user(t: Backend) {
  return (await t.mutation(api.meetings.ensureUser, { internalSecret: secret })).userId;
}
async function verify(t: Backend, email: string, currentUserId: Id<"users">) {
  const link = await t.mutation(api.meetings.requestEmailVerificationForDelivery, {
    internalSecret: secret,
    email,
  });
  return t.mutation(api.meetings.completeEmailVerificationForUser, {
    internalSecret: secret,
    currentUserId,
    magicLinkToken: link.rawMagicLinkToken!,
  });
}
async function credential(t: Backend, email = "owner@example.test") {
  const owner = await verify(t, email, await user(t));
  const token = await t.mutation(api.agentApi.createApiToken, {
    internalSecret: secret,
    emailIdentityId: owner.emailIdentityId,
    scopes: [
      "meetings:create",
      "meetings:read",
      "availability:write",
      "meetings:finalize",
    ],
  });
  return { ...owner, tokenHash: await hashSecretToken(token.apiToken) };
}

beforeEach(() => {
  vi.stubEnv("MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET", secret);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("verified ownership", () => {
  it.each([false, true])(
    "does not merge a victim into an unverified claimant (legacy=%s)",
    async (legacy) => {
      const t = makeBackend();
      const attacker = await user(t);
      const victim = await user(t);
      await t.mutation(api.meetings.createMeeting, {
        internalSecret: secret,
        userId: attacker,
        title: "Claimant's meeting",
        creatorEmail: "victim@example.test",
        settings,
      });
      const identity = await t.run((ctx) => ctx.db.query("emailIdentities").unique());
      expect(identity?.userId).toBeUndefined();
      if (legacy) {
        await t.run((ctx) => ctx.db.patch(identity!._id, { userId: attacker }));
      }
      const privateMeeting = await t.mutation(api.meetings.createMeeting, {
        internalSecret: secret,
        userId: victim,
        title: "Victim's private meeting",
        settings,
      });
      const verified = await verify(t, "victim@example.test", victim);
      expect(verified.userId).toBe(victim);
      const attackerSession = await t.query(api.meetings.readUserSession, {
        internalSecret: secret,
        userId: attacker,
      });
      expect(attackerSession).toMatchObject({ status: "active", verifiedEmails: [] });
      await expect(
        t.mutation(api.meetings.createRecoveredUserMembershipLink, {
          internalSecret: secret,
          userId: attacker,
          membershipId: privateMeeting.adminMembershipId,
        }),
      ).rejects.toThrow(/not recoverable/);
      const recovered = await t.mutation(api.meetings.createRecoveredUserMembershipLink, {
        internalSecret: secret,
        userId: victim,
        membershipId: privateMeeting.adminMembershipId,
      });
      expect(
        (
          await t.query(api.meetings.readMeetingByMembershipToken, {
            membershipToken: recovered.membershipToken,
          })
        )?.capabilities.canAdminister,
      ).toBe(true);
    },
  );

  it("preserves the verified account when signing in from another anonymous browser", async () => {
    const t = makeBackend();
    const owner = await verify(t, "owner@example.test", await user(t));
    const browser = await user(t);
    const meeting = await t.mutation(api.meetings.createMeeting, {
      internalSecret: secret,
      userId: browser,
      title: "Other browser",
      settings,
    });
    // The production cooldown is five minutes; make the consumed link old.
    await t.run(async (ctx) => {
      for (const link of await ctx.db.query("magicLinks").collect()) {
        await ctx.db.patch(link._id, { createdAt: Date.now() - 600_000 });
      }
    });
    expect((await verify(t, "owner@example.test", browser)).userId).toBe(owner.userId);
    expect((await t.run((ctx) => ctx.db.get(meeting.adminMembershipId)))?.userId).toBe(
      owner.userId,
    );
  });

  it("recovers email-linked meetings on a new device without merging the original browser's unrelated meetings", async () => {
    const t = makeBackend();
    const original = await user(t);
    const emailed = await t.mutation(api.meetings.createMeeting, {
      internalSecret: secret,
      userId: original,
      title: "Recoverable email meeting",
      creatorEmail: "owner@example.test",
      settings,
    });
    const unrelated = await t.mutation(api.meetings.createMeeting, {
      internalSecret: secret,
      userId: original,
      title: "Other person's meeting",
      settings,
    });
    const newBrowser = await user(t);
    await verify(t, "owner@example.test", newBrowser);
    expect((await t.run((ctx) => ctx.db.get(emailed.adminMembershipId)))?.userId).toBe(
      newBrowser,
    );
    expect((await t.run((ctx) => ctx.db.get(unrelated.adminMembershipId)))?.userId).toBe(
      original,
    );
    const dashboard = await t.query(api.meetings.listUserDashboard, {
      internalSecret: secret,
      userId: newBrowser,
    });
    expect(dashboard.memberships.map((m) => m.membershipId)).toEqual([
      emailed.adminMembershipId,
    ]);
  });

  it("continues email membership recovery in scheduled batches", async () => {
    vi.useFakeTimers();
    const t = makeBackend();
    const meeting = await t.mutation(api.meetings.createMeeting, {
      title: "Legacy recovery",
      creatorEmail: "batch@example.test",
      settings,
    });
    const emailIdentityId = await t.run(async (ctx) => {
      const original = (await ctx.db.get(meeting.adminMembershipId))!;
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("memberships", {
          meetingId: meeting.meetingId,
          emailIdentityId: original.emailIdentityId,
          role: "member",
          privacyMode: "detailed",
          tokenHash: `legacy-${i}`,
          tokenFingerprint: `legacy-${i}`,
          tokenVersion: 1,
          tokenCreatedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return original.emailIdentityId!;
    });
    const owner = await user(t);
    await verify(t, "batch@example.test", owner);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_email_identity", (q) => q.eq("emailIdentityId", emailIdentityId))
        .collect(),
    );
    expect(memberships).toHaveLength(102);
    expect(memberships.every((m) => m.userId === owner)).toBe(true);
  });
});

describe("API and web membership ownership", () => {
  it("lists API-created meetings and permits only the owner to recover them", async () => {
    const t = makeBackend();
    const owner = await credential(t);
    const meeting = await t.mutation(api.agentApi.createMeeting, {
      tokenHash: owner.tokenHash,
      title: "API meeting",
      settings,
    });
    const dashboard = await t.query(api.meetings.listUserDashboard, {
      internalSecret: secret,
      userId: owner.userId,
    });
    expect(dashboard.memberships.map((m) => m.membershipId)).toContain(
      meeting.adminMembershipId,
    );
    await expect(
      t.mutation(api.meetings.createRecoveredUserMembershipLink, {
        internalSecret: secret,
        userId: await user(t),
        membershipId: meeting.adminMembershipId,
      }),
    ).rejects.toThrow(/not recoverable/);
    await expect(
      t.mutation(api.meetings.createRecoveredUserMembershipLink, {
        internalSecret: secret,
        userId: owner.userId,
        membershipId: meeting.adminMembershipId,
      }),
    ).resolves.toHaveProperty("membershipToken");
  });

  it("links API participants and repairs legacy memberships without changing existing owners", async () => {
    const t = makeBackend();
    const owner = await credential(t);
    const meeting = await t.mutation(api.meetings.createMeeting, {
      title: "Public meeting",
      settings,
    });
    const participant = await t.mutation(api.agentApi.createParticipant, {
      tokenHash: owner.tokenHash,
      meetingSlug: meeting.slug,
      displayName: "Owner",
    });
    expect((await t.run((ctx) => ctx.db.get(participant.membershipId)))?.userId).toBe(
      owner.userId,
    );
    await t.run((ctx) => ctx.db.patch(participant.membershipId, { userId: undefined }));
    let cursor: string | null = null;
    let updated = 0;
    for (;;) {
      const page: FunctionReturnType<
        typeof internal.maintenance.backfillMembershipUsers
      > = await t.mutation(internal.maintenance.backfillMembershipUsers, {
        paginationOpts: { numItems: 1, cursor },
      });
      updated += page.updated;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(updated).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(participant.membershipId)))?.userId).toBe(
      owner.userId,
    );
    const secondPass = await t.mutation(internal.maintenance.backfillMembershipUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(secondPass.updated).toBe(0);
    const otherOwner = await user(t);
    await t.run((ctx) => ctx.db.patch(participant.membershipId, { userId: otherOwner }));
    await t.mutation(internal.maintenance.backfillMembershipUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect((await t.run((ctx) => ctx.db.get(participant.membershipId)))?.userId).toBe(
      otherOwner,
    );
  });

  it("refuses unverified identities during the legacy backfill", async () => {
    const t = makeBackend();
    const meeting = await t.mutation(api.meetings.createMeeting, {
      title: "Unverified",
      creatorEmail: "unverified@example.test",
      settings,
    });
    await t.mutation(internal.maintenance.backfillMembershipUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(
      (await t.run((ctx) => ctx.db.get(meeting.adminMembershipId)))?.userId,
    ).toBeUndefined();
  });
});

describe("calendar write boundaries", () => {
  it("rejects oversized calendars in browser creation, API creation, and settings updates", async () => {
    const t = makeBackend();
    const oversized = {
      ...settings,
      allowedTimeRanges: [
        {
          startUtc: "2026-01-01T00:00:00Z",
          endUtc: "2036-01-01T00:00:00Z",
        },
      ],
    };
    await expect(
      t.mutation(api.meetings.createMeeting, {
        title: "Oversized",
        settings: oversized,
      }),
    ).rejects.toThrow(/42 days/);
    const owner = await credential(t);
    await expect(
      t.mutation(api.agentApi.createMeeting, {
        tokenHash: owner.tokenHash,
        title: "Oversized API",
        settings: oversized,
      }),
    ).rejects.toThrow(/42 days/);
    const meeting = await t.mutation(api.meetings.createMeeting, {
      title: "Normal",
      settings,
    });
    await expect(
      t.mutation(api.meetings.updateMeetingSettings, {
        membershipToken: meeting.adminMembershipToken,
        settings: oversized,
      }),
    ).rejects.toThrow(/42 days/);
    expect(
      (await t.run((ctx) => ctx.db.get(meeting.meetingId)))?.allowedTimeRanges[0].endUtc,
    ).toBe("2026-09-20T12:00:00.000Z");
  });
});

describe("shared lifecycle operations", () => {
  it.each(["browser", "api"] as const)(
    "preserves lifecycle events and notifications for %s",
    async (channel) => {
      const t = makeBackend();
      const owner = await credential(t);
      const meeting = await t.mutation(api.meetings.createMeeting, {
        internalSecret: secret,
        userId: owner.userId,
        title: "Lifecycle",
        creatorEmail: owner.normalizedEmail,
        settings,
      });
      const finalizedSlot = {
        startUtc: "2026-09-20T09:00:00Z",
        endUtc: "2026-09-20T10:00:00Z",
        timeZone: "UTC",
      };
      if (channel === "browser") {
        await t.mutation(api.meetings.finalizeMeeting, {
          membershipToken: meeting.adminMembershipToken,
          finalizedSlot,
        });
        await t.mutation(api.meetings.reopenMeeting, {
          membershipToken: meeting.adminMembershipToken,
        });
      } else {
        await t.mutation(api.agentApi.finalizeMeeting, {
          tokenHash: owner.tokenHash,
          meetingSlug: meeting.slug,
          finalizedSlot,
        });
        await t.mutation(api.agentApi.reopenMeeting, {
          tokenHash: owner.tokenHash,
          meetingSlug: meeting.slug,
        });
      }
      const saved = await t.run((ctx) => ctx.db.get(meeting.meetingId));
      expect(saved?.lifecycleState).toBe("open");
      expect(saved?.lifecycleRevision).toBe(3);
      expect(saved?.finalizedSlot).toBeUndefined();
      const events = await t.run((ctx) =>
        ctx.db
          .query("auditEvents")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meeting.meetingId))
          .collect(),
      );
      const suffix = channel === "api" ? "_by_api" : "";
      expect(events.map((e) => e.kind)).toEqual([
        "meeting.created",
        `meeting.finalized${suffix}`,
        `meeting.reopened${suffix}`,
      ]);
      const notifications = await t.run((ctx) =>
        ctx.db
          .query("notificationOutbox")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meeting.meetingId))
          .collect(),
      );
      expect(notifications.map((n) => n.kind)).toEqual([
        "meeting.finalized",
        "meeting.reopened",
      ]);
      expect(
        notifications.every((n) => n.emailIdentityId === owner.emailIdentityId),
      ).toBe(true);
    },
  );
});

describe("retention scan progress", () => {
  it("advances past protected meetings across runs and leaves dry runs read-only", async () => {
    const t = makeBackend();
    const ids = await t.run(async (ctx) => {
      const identity = await ctx.db.insert("emailIdentities", {
        normalizedEmail: "protected@example.test",
        createdAt: 1,
        updatedAt: 1,
      });
      const meetings: Id<"meetings">[] = [];
      for (let i = 0; i < 27; i++) {
        const meetingId = await ctx.db.insert("meetings", {
          title: `Old ${i}`,
          slug: `old-${i}`,
          lifecycleState: "open",
          lifecycleRevision: 1,
          adminMode: "roleBased",
          ...settings,
          allowedTimeRanges: settings.allowedTimeRanges.map((r) => ({
            ...r,
            timeZone: "UTC",
          })),
          createdAt: 1 + i,
          updatedAt: 1,
        });
        await ctx.db.insert("memberships", {
          meetingId,
          emailIdentityId: i < 25 ? identity : undefined,
          role: "admin",
          privacyMode: "detailed",
          tokenHash: `hash-${i}`,
          tokenFingerprint: `fingerprint-${i}`,
          tokenVersion: 1,
          tokenCreatedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        meetings.push(meetingId);
      }
      return meetings;
    });
    const args = { internalSecret: secret, now: 200 * 86_400_000, limit: 50 };
    const dry = await t.mutation(api.maintenance.cleanupRetainedData, args);
    expect(dry.anonymousMeetings).toBe(0);
    expect(dry.meetingScanDone).toBe(false);
    const preview = await t.mutation(api.maintenance.cleanupRetainedData, {
      ...args,
      meetingPagination: { numItems: 25, cursor: dry.meetingContinueCursor },
    });
    expect(preview.anonymousMeetings).toBe(2);
    expect(await t.run((ctx) => ctx.db.query("maintenanceCursors").collect())).toEqual(
      [],
    );
    const first = await t.mutation(api.maintenance.cleanupRetainedData, {
      ...args,
      dryRun: false,
    });
    expect(first.anonymousMeetings).toBe(0);
    const second = await t.mutation(api.maintenance.cleanupRetainedData, {
      ...args,
      dryRun: false,
    });
    expect(second.anonymousMeetings).toBe(2);
    expect(second.meetingScanDone).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids[25]))).toBeNull();
  });
});
