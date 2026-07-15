import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  enforceRequestRateLimit,
  RateLimitError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { buildAbsoluteAppUrl, routes } from "@/lib/routes";
import { safeErrorMessage } from "@/lib/security-redaction";
import { readUserSession } from "@/lib/user-server-session";

export async function POST(request: NextRequest) {
  const session = await readUserSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Open or create a meeting first." },
      { status: 401 },
    );
  }

  try {
    await enforceRequestRateLimit({
      request,
      scope: "identity.recover_membership",
      key: session.userId,
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    const body = (await request.json()) as { membershipId?: string };
    if (!body.membershipId) {
      return NextResponse.json({ error: "Membership id is required." }, { status: 400 });
    }

    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.createRecoveredUserMembershipLink, {
      internalSecret: getInternalIdentitySecret(),
      userId: session.userId,
      membershipId: body.membershipId as Id<"memberships">,
    });
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      membershipUrl: buildAbsoluteAppUrl(
        routes.membershipLink(result.membershipToken),
        origin,
      ),
      tokenFingerprint: result.tokenFingerprint,
    });
  } catch (caughtError) {
    if (caughtError instanceof RateLimitError) {
      return rateLimitErrorResponse(caughtError);
    }
    return NextResponse.json(
      {
        error: safeErrorMessage(caughtError, "Unable to restore access to this meeting."),
      },
      { status: 400 },
    );
  }
}
