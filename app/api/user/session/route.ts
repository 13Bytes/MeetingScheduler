import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/security-redaction";
import {
  ensureUserSession,
  expireUserSession,
  readUserSession,
} from "@/lib/user-server-session";

export async function GET(request: NextRequest) {
  try {
    const existingSession = await readUserSession(request);
    const response = NextResponse.json(
      existingSession
        ? {
            signedIn: true,
            userId: existingSession.userId,
            expiresAt: existingSession.expiresAt,
            verifiedEmails: existingSession.verifiedEmails,
          }
        : { signedIn: false },
    );

    if (existingSession) {
      await ensureUserSession(request, response);
    } else {
      expireUserSession(response);
    }
    return response;
  } catch (caughtError) {
    console.error(
      "Failed to resolve user session",
      safeErrorMessage(caughtError, "user session resolution failed"),
    );
    return NextResponse.json(
      { signedIn: false, error: "Unable to verify this user session." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const response = NextResponse.json({});
    const session = await ensureUserSession(request, response);
    return NextResponse.json(
      {
        signedIn: true,
        userId: session.userId,
        expiresAt: session.expiresAt,
      },
      {
        headers: response.headers,
      },
    );
  } catch (caughtError) {
    return NextResponse.json(
      { error: safeErrorMessage(caughtError, "Unable to create user session.") },
      { status: 503 },
    );
  }
}
