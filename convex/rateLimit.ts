import type { MutationCtx } from "./_generated/server";
import {
  evaluateDurableRateLimit,
  normalizeDurableRateLimitKey,
} from "./domain/rate-limit";

export async function assertConvexRateLimit(
  ctx: MutationCtx,
  args: {
    scope: string;
    key: string;
    limit: number;
    windowMs: number;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const key = normalizeDurableRateLimitKey(args.key);
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_scope_key", (q) => q.eq("scope", args.scope).eq("key", key))
    .unique();
  const decision = evaluateDurableRateLimit({
    existing,
    limit: args.limit,
    now,
    windowMs: args.windowMs,
  });

  if (existing) {
    await ctx.db.patch(existing._id, {
      count: decision.count,
      windowStartedAt: decision.windowStartedAt,
      expiresAt: decision.expiresAt,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("rateLimits", {
      scope: args.scope,
      key,
      count: decision.count,
      windowStartedAt: decision.windowStartedAt,
      expiresAt: decision.expiresAt,
      updatedAt: now,
    });
  }

  if (!decision.allowed) {
    throw new Error("Rate limit exceeded. Please wait before trying again.");
  }
}
