import { describe, expect, it } from "vitest";
import {
  buildFinalizeMeetingPatch,
  buildLifecycleNotificationPlaceholders,
  buildReopenMeetingPatch,
} from "./finalization";

const finalizedSlot = {
  startUtc: "2026-06-24T07:00:00.000Z",
  endUtc: "2026-06-24T08:00:00.000Z",
  timeZone: "Europe/Berlin",
};

describe("finalization side effects", () => {
  it("builds the meeting patch for finalizing a selected slot", () => {
    expect(
      buildFinalizeMeetingPatch({
        lifecycleRevision: 3,
        finalizedAt: 1234,
        finalizedByMembershipId: "admin-1",
        finalizedSlot,
      }),
    ).toEqual({
      lifecycleState: "finalized",
      lifecycleRevision: 4,
      finalizedAt: 1234,
      finalizedByMembershipId: "admin-1",
      finalizedSlot,
      updatedAt: 1234,
    });
  });

  it("builds the meeting patch for reopening and clears the current final slot", () => {
    expect(
      buildReopenMeetingPatch({
        lifecycleRevision: 4,
        reopenedAt: 5678,
        reopenedByMembershipId: "admin-1",
      }),
    ).toEqual({
      lifecycleState: "open",
      lifecycleRevision: 5,
      finalizedAt: undefined,
      finalizedByMembershipId: undefined,
      finalizedSlot: undefined,
      reopenedAt: 5678,
      reopenedByMembershipId: "admin-1",
      updatedAt: 5678,
    });
  });

  it("queues notification placeholders only for active memberships with email identities", () => {
    const placeholders = buildLifecycleNotificationPlaceholders({
      meetingId: "meeting-1",
      memberships: [
        { _id: "admin-1", emailIdentityId: "email-1" },
        { _id: "admin-2", emailIdentityId: "email-1" },
        { _id: "member-1" },
        { _id: "member-2", emailIdentityId: "email-2", revokedAt: 999 },
        { _id: "member-3", emailIdentityId: "email-3" },
        { _id: "member-4", emailIdentityId: "email-4" },
      ],
      emailIdentities: [
        { _id: "email-1", normalizedEmail: "admin@example.com", verifiedAt: 100 },
        { _id: "email-2", normalizedEmail: "revoked@example.com", verifiedAt: 100 },
        { _id: "email-3", normalizedEmail: "member@example.com", verifiedAt: 100 },
        { _id: "email-4", normalizedEmail: "unverified@example.com" },
      ],
      kind: "meeting.finalized",
      lifecycleRevision: 4,
      payload: { ...finalizedSlot, lifecycleRevision: 99 },
      now: 1234,
    });

    expect(placeholders).toEqual([
      {
        meetingId: "meeting-1",
        membershipId: "admin-1",
        emailIdentityId: "email-1",
        kind: "meeting.finalized",
        status: "queued",
        dedupeKey: "meeting.finalized:meeting-1:4:email-1",
        payload: { lifecycleRevision: 4, ...finalizedSlot },
        attempts: 0,
        createdAt: 1234,
        updatedAt: 1234,
      },
      {
        meetingId: "meeting-1",
        membershipId: "member-3",
        emailIdentityId: "email-3",
        kind: "meeting.finalized",
        status: "queued",
        dedupeKey: "meeting.finalized:meeting-1:4:email-3",
        payload: { lifecycleRevision: 4, ...finalizedSlot },
        attempts: 0,
        createdAt: 1234,
        updatedAt: 1234,
      },
    ]);
  });

  it("builds reopen notification placeholders with a distinct lifecycle revision", () => {
    expect(
      buildLifecycleNotificationPlaceholders({
        meetingId: "meeting-1",
        memberships: [{ _id: "member-1", emailIdentityId: "email-1" }],
        emailIdentities: [
          { _id: "email-1", normalizedEmail: "member@example.com", verifiedAt: 100 },
        ],
        kind: "meeting.reopened",
        lifecycleRevision: 5,
        payload: {},
        now: 5678,
      }),
    ).toMatchObject([
      {
        kind: "meeting.reopened",
        status: "queued",
        dedupeKey: "meeting.reopened:meeting-1:5:email-1",
        payload: { lifecycleRevision: 5 },
      },
    ]);
  });
});
