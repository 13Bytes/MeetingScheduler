import { NextRequest, NextResponse } from "next/server";
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

  return NextResponse.json(
    session
      ? {
          signedIn: true,
          emailIdentityId: session.emailIdentityId,
          normalizedEmail: session.normalizedEmail,
          expiresAt: session.expiresAt,
        }
      : { signedIn: false },
  );
}
