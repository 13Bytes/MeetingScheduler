import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  buildExpiredIdentitySessionCookie,
  getIdentitySessionSecret,
  identitySessionCookieName,
  verifyEmailIdentitySession,
} from "@/lib/identity-session";
import { safeErrorMessage } from "@/lib/security-redaction";
import { readUserSession } from "@/lib/user-server-session";

export async function GET(request: NextRequest) {
  try {
    const userSession = await readUserSession(request);
    const primaryVerifiedEmail = userSession?.verifiedEmails[0];
    if (userSession && primaryVerifiedEmail) {
      return NextResponse.json({
        signedIn: true,
        emailIdentityId: primaryVerifiedEmail.emailIdentityId,
        normalizedEmail: primaryVerifiedEmail.normalizedEmail,
        expiresAt: userSession.expiresAt,
      });
    }
  } catch {
    // Fall back to the legacy email session path below.
  }

  const session = verifyEmailIdentitySession(
    request.cookies.get(identitySessionCookieName)?.value,
    getIdentitySessionSecret(),
  );

  if (!session) {
    return NextResponse.json({ signedIn: false });
  }

  try {
    const convex = new ConvexHttpClient(getConvexUrl());
    const identity = await convex.query(api.meetings.readEmailIdentitySession, {
      internalSecret: getInternalIdentitySecret(),
      emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
    });

    if (identity.status === "stale") {
      const response = NextResponse.json({ signedIn: false });
      response.headers.append("Set-Cookie", buildExpiredIdentitySessionCookie());
      return response;
    }

    return NextResponse.json({
      signedIn: true,
      emailIdentityId: identity.emailIdentityId,
      normalizedEmail: identity.normalizedEmail,
      expiresAt: session.expiresAt,
    });
  } catch (caughtError) {
    console.error(
      "Failed to resolve email identity session",
      safeErrorMessage(caughtError, "session resolution failed"),
    );
    return NextResponse.json(
      { signedIn: false, error: "Unable to verify this email session." },
      { status: 503 },
    );
  }
}
