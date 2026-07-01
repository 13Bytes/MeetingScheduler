import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  getIdentitySessionSecret,
  identitySessionCookieName,
  verifyEmailIdentitySession,
} from "@/lib/identity-session";
import { buildAbsoluteAppUrl, routes } from "@/lib/routes";

export async function POST(request: NextRequest) {
  const session = verifyEmailIdentitySession(
    request.cookies.get(identitySessionCookieName)?.value,
    getIdentitySessionSecret(),
  );
  if (!session) {
    return NextResponse.json({ error: "Verify your email first." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { membershipId?: string };
    if (!body.membershipId) {
      return NextResponse.json({ error: "Membership id is required." }, { status: 400 });
    }

    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.createRecoveredMembershipLink, {
      internalSecret: getInternalIdentitySecret(),
      emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
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
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to recover this membership link.",
      },
      { status: 400 },
    );
  }
}
