import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { PaginationOptions } from "convex/server";
import { assertVerifiedEmailIdentity } from "../domain/identity";
import { createSecretToken } from "../domain/tokens";

/** Only an already verified identity may supply the API membership's owner. */
export async function ensureVerifiedIdentityUser(
  ctx: MutationCtx,
  identity: Doc<"emailIdentities">,
  now: number,
): Promise<Id<"users">> {
  assertVerifiedEmailIdentity(identity);
  if (identity.userId && (await ctx.db.get(identity.userId))) {
    return identity.userId;
  }
  const userId = await ctx.db.insert("users", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  });
  await ctx.db.patch(identity._id, { userId, updatedAt: now });
  return userId;
}

/** Keep browser and API membership writes on the same schema and token defaults. */
export async function insertMembership(
  ctx: MutationCtx,
  input: Pick<
    Doc<"memberships">,
    "meetingId" | "emailIdentityId" | "userId" | "displayName" | "role" | "privacyMode"
  >,
  token: Awaited<ReturnType<typeof createSecretToken>>,
  now: number,
) {
  return await ctx.db.insert("memberships", {
    ...input,
    tokenHash: token.tokenHash,
    tokenFingerprint: token.tokenFingerprint,
    tokenVersion: 1,
    tokenCreatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/** Email proof recovers only memberships naming that email, never its claimant's account. */
export async function linkVerifiedIdentityMembershipPage(
  ctx: MutationCtx,
  emailIdentityId: Id<"emailIdentities">,
  paginationOpts: PaginationOptions,
): Promise<{ continueCursor: string; isDone: boolean }> {
  const identity = await ctx.db.get(emailIdentityId);
  assertVerifiedEmailIdentity(identity);
  const userId = await ensureVerifiedIdentityUser(ctx, identity, Date.now());
  const page = await ctx.db
    .query("memberships")
    .withIndex("by_email_identity", (q) => q.eq("emailIdentityId", identity._id))
    .paginate(paginationOpts);
  for (const membership of page.page) {
    if (membership.revokedAt === undefined && membership.userId !== userId) {
      await ctx.db.patch(membership._id, { userId });
    }
  }
  return { continueCursor: page.continueCursor, isDone: page.isDone };
}
