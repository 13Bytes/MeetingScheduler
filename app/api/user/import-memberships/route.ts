import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  enforceRequestRateLimit,
  getClientIp,
  RateLimitError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/security-redaction";
import { readBoundedJsonObject } from "@/lib/request-json";
import { ensureUserSession } from "@/lib/user-server-session";

export async function POST(request: NextRequest) {
  try {
    await enforceRequestRateLimit({
      request,
      scope: "user.import_memberships.ip",
      key: getClientIp(request),
      limit: 60,
      windowMs: 15 * 60 * 1000,
    });
    const body = await readBoundedJsonObject<{ membershipTokens?: string[] }>(request);
    const membershipTokens = Array.from(
      new Set(
        (body.membershipTokens ?? [])
          .filter((token): token is string => typeof token === "string")
          .map((token) => token.trim())
          .filter(Boolean),
      ),
    ).slice(0, 50);
    if (membershipTokens.length === 0) {
      return NextResponse.json({
        importedMembershipIds: [],
        ignoredTokenFingerprints: [],
      });
    }

    const response = NextResponse.json({});
    const session = await ensureUserSession(request, response);
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.attachMembershipTokensToUser, {
      internalSecret: getInternalIdentitySecret(),
      userId: session.userId,
      membershipTokens,
    });

    return NextResponse.json(result, {
      headers: response.headers,
    });
  } catch (caughtError) {
    if (caughtError instanceof RateLimitError) {
      return rateLimitErrorResponse(caughtError);
    }
    return NextResponse.json(
      { error: safeErrorMessage(caughtError, "Unable to import memberships.") },
      { status: 400 },
    );
  }
}
