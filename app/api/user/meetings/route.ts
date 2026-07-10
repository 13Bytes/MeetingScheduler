import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  enforceRequestRateLimit,
  getClientIp,
  RateLimitError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/security-redaction";
import { readBoundedJsonObject } from "@/lib/request-json";
import { ensureUserSession } from "@/lib/user-server-session";

type CreateMeetingRequest = {
  title?: string;
  description?: string;
  creatorEmail?: string;
  clientRateLimitKey?: string;
  creatorPrivacyMode?: "detailed" | "summaryOnly";
  adminMode?: "roleBased" | "everyoneAdmin";
  settings?: {
    canonicalTimeZone?: string;
    durationMinutes?: number;
    granularityMinutes?: number;
    allowedTimeRanges?: {
      startUtc: string;
      endUtc: string;
      timeZone?: string;
      label?: string;
    }[];
  };
};

export async function POST(request: NextRequest) {
  try {
    await enforceRequestRateLimit({
      request,
      scope: "user.meeting_create.ip",
      key: getClientIp(request),
      limit: 30,
      windowMs: 15 * 60 * 1000,
    });
    const body = await readBoundedJsonObject<CreateMeetingRequest>(request);
    if (!body.title) {
      return NextResponse.json({ error: "Meeting title is required." }, { status: 400 });
    }

    const response = NextResponse.json({});
    const session = await ensureUserSession(request, response);
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.meetings.createMeeting, {
      title: body.title,
      description: body.description,
      creatorEmail: body.creatorEmail,
      clientRateLimitKey: body.clientRateLimitKey,
      creatorPrivacyMode: body.creatorPrivacyMode,
      adminMode: body.adminMode,
      settings: body.settings,
      internalSecret: getInternalIdentitySecret(),
      userId: session.userId,
    });

    const finalResponse = NextResponse.json(result);
    const setCookieHeader = response.headers.get("Set-Cookie");
    if (setCookieHeader) {
      finalResponse.headers.set("Set-Cookie", setCookieHeader);
    }
    return finalResponse;
  } catch (caughtError) {
    if (caughtError instanceof RateLimitError) {
      return rateLimitErrorResponse(caughtError);
    }
    return NextResponse.json(
      { error: safeErrorMessage(caughtError, "Unable to create meeting.") },
      { status: 400 },
    );
  }
}
