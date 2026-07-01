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

export async function GET(request: NextRequest) {
  const session = verifyEmailIdentitySession(
    request.cookies.get(identitySessionCookieName)?.value,
    getIdentitySessionSecret(),
  );

  if (!session) {
    return NextResponse.json({ signedIn: false });
  }

  try {
    const convex = new ConvexHttpClient(getConvexUrl());
    const identity = await convex.query(api.meetings.readVerifiedEmailIdentity, {
      internalSecret: getInternalIdentitySecret(),
      emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
    });

    return NextResponse.json({
      signedIn: true,
      emailIdentityId: identity.emailIdentityId,
      normalizedEmail: identity.normalizedEmail,
      expiresAt: session.expiresAt,
    });
  } catch {
    return NextResponse.json({ signedIn: false });
  }
}
