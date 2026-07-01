import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexUrl } from "@/lib/identity-internal";
import {
  buildIdentitySessionCookie,
  createEmailIdentitySession,
  getIdentitySessionSecret,
} from "@/lib/identity-session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirectUrl = new URL("/identity/dashboard", request.url);
  if (!token) {
    redirectUrl.searchParams.set("error", "missing-token");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.completeEmailVerification, {
      magicLinkToken: token,
    });
    const sessionToken = createEmailIdentitySession(
      {
        emailIdentityId: result.emailIdentityId,
        normalizedEmail: result.normalizedEmail,
      },
      getIdentitySessionSecret(),
    );
    const response = NextResponse.redirect(redirectUrl);
    response.headers.append(
      "Set-Cookie",
      buildIdentitySessionCookie(sessionToken, {
        secure: request.nextUrl.protocol === "https:",
      }),
    );
    return response;
  } catch {
    redirectUrl.searchParams.set("error", "invalid-token");
    return NextResponse.redirect(redirectUrl);
  }
}
