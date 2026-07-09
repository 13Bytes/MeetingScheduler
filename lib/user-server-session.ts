import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import { getIdentitySessionSecret } from "@/lib/identity-session";
import {
  buildExpiredUserSessionCookie,
  buildUserSessionCookie,
  createUserSession,
  userSessionCookieName,
  verifyUserSession,
} from "@/lib/user-session";

export type EnsuredUserSession = {
  userId: Id<"users">;
  expiresAt: number;
};

export async function ensureUserSession(
  request: NextRequest,
  response: NextResponse,
): Promise<EnsuredUserSession> {
  const sessionSecret = getIdentitySessionSecret();
  const existingSession = verifyUserSession(
    request.cookies.get(userSessionCookieName)?.value,
    sessionSecret,
  );
  const convex = new ConvexHttpClient(getConvexUrl());
  const ensured = await convex.mutation(api.meetings.ensureUser, {
    internalSecret: getInternalIdentitySecret(),
    userId: existingSession?.userId as Id<"users"> | undefined,
  });
  const sessionToken = createUserSession(
    {
      userId: ensured.userId,
    },
    sessionSecret,
  );
  const refreshedSession = verifyUserSession(sessionToken, sessionSecret);
  if (!refreshedSession) {
    throw new Error("Unable to create a valid user session");
  }
  response.headers.append(
    "Set-Cookie",
    buildUserSessionCookie(sessionToken, {
      secure: request.nextUrl.protocol === "https:",
    }),
  );
  return {
    userId: ensured.userId as Id<"users">,
    expiresAt: refreshedSession.expiresAt,
  };
}

export async function readUserSession(request: NextRequest) {
  const sessionSecret = getIdentitySessionSecret();
  const session = verifyUserSession(
    request.cookies.get(userSessionCookieName)?.value,
    sessionSecret,
  );
  if (!session) {
    return null;
  }

  const convex = new ConvexHttpClient(getConvexUrl());
  const resolved = await convex.query(api.meetings.readUserSession, {
    internalSecret: getInternalIdentitySecret(),
    userId: session.userId as Id<"users">,
  });
  if (resolved.status === "stale") {
    return null;
  }

  return {
    userId: resolved.userId as Id<"users">,
    expiresAt: session.expiresAt,
    verifiedEmails: resolved.verifiedEmails,
  };
}

export function expireUserSession(response: NextResponse): void {
  response.headers.append("Set-Cookie", buildExpiredUserSessionCookie());
}
