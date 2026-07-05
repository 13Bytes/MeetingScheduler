import { v } from "convex/values";
import { apiTokenScopes } from "./agent-api";

export const lifecycleStateValidator = v.union(v.literal("open"), v.literal("finalized"));

export const adminModeValidator = v.union(
  v.literal("roleBased"),
  v.literal("everyoneAdmin"),
);

export const membershipRoleValidator = v.union(v.literal("admin"), v.literal("member"));

export const privacyModeValidator = v.union(
  v.literal("detailed"),
  v.literal("summaryOnly"),
);

export const availabilityResponseValidator = v.union(
  v.literal("yes"),
  v.literal("reluctant"),
  v.literal("no"),
);

export const notificationStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const magicLinkPurposeValidator = v.union(
  v.literal("emailVerification"),
  v.literal("membershipRecovery"),
);

export const apiTokenScopeValidator = v.union(
  ...apiTokenScopes.map((scope) => v.literal(scope)),
);

export const allowedTimeRangeValidator = v.object({
  startUtc: v.string(),
  endUtc: v.string(),
  timeZone: v.string(),
  label: v.optional(v.string()),
});

export const finalizedSlotValidator = v.object({
  startUtc: v.string(),
  endUtc: v.string(),
  timeZone: v.optional(v.string()),
});

export const tokenFieldsValidator = {
  tokenHash: v.string(),
  tokenFingerprint: v.string(),
  tokenVersion: v.number(),
  tokenCreatedAt: v.number(),
} as const;

export const metadataValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.null()),
);
