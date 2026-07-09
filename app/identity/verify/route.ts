import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  buildIdentitySessionCookie,
  createEmailIdentitySession,
  getIdentitySessionSecret,
} from "@/lib/identity-session";
import { ensureUserSession } from "@/lib/user-server-session";
import { buildUserSessionCookie, createUserSession } from "@/lib/user-session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirectUrl = new URL("/identity/dashboard", request.url);
  if (!token) {
    redirectUrl.searchParams.set("error", "missing-token");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const response = NextResponse.redirect(redirectUrl);
    const currentSession = await ensureUserSession(request, response);
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.completeEmailVerificationForUser, {
      internalSecret: getInternalIdentitySecret(),
      magicLinkToken: token,
      currentUserId: currentSession.userId,
    });
    const sessionToken = createEmailIdentitySession(
      {
        emailIdentityId: result.emailIdentityId,
      },
      getIdentitySessionSecret(),
    );
    response.headers.append(
      "Set-Cookie",
      buildIdentitySessionCookie(sessionToken, {
        secure: request.nextUrl.protocol === "https:",
      }),
    );
    const userSessionToken = createUserSession(
      {
        userId: result.userId as Id<"users">,
      },
      getIdentitySessionSecret(),
    );
    response.headers.append(
      "Set-Cookie",
      buildUserSessionCookie(userSessionToken, {
        secure: request.nextUrl.protocol === "https:",
      }),
    );
    return response;
  } catch {
    redirectUrl.searchParams.set("error", "invalid-token");
    return NextResponse.redirect(redirectUrl);
  }
}
