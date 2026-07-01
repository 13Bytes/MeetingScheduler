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

export async function POST(request: NextRequest) {
  const session = verifyEmailIdentitySession(
    request.cookies.get(identitySessionCookieName)?.value,
    getIdentitySessionSecret(),
  );
  if (!session) {
    return NextResponse.json({ error: "Verify your email first." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { membershipToken?: string };
    if (!body.membershipToken) {
      return NextResponse.json(
        { error: "Membership token is required." },
        { status: 400 },
      );
    }

    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(
      api.meetings.attachVerifiedEmailIdentityToMembership,
      {
        internalSecret: getInternalIdentitySecret(),
        emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
        membershipToken: body.membershipToken,
      },
    );
    return NextResponse.json(result);
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to attach this email identity.",
      },
      { status: 400 },
    );
  }
}
