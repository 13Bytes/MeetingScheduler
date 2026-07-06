import { NextRequest, NextResponse } from "next/server";
import {
  enforceRequestRateLimit,
  getClientIp,
  RateLimitError,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const scope = pathname.startsWith("/api/")
    ? `route.api.${request.method}.${pathname}`
    : pathname.startsWith("/join/")
      ? "route.membership_link"
      : "route.public_meeting";

  try {
    await enforceRequestRateLimit({
      request,
      scope,
      key: getClientIp(request),
      limit: pathname.startsWith("/api/") ? 120 : 240,
      windowMs: 60 * 1000,
    });
    return NextResponse.next();
  } catch (caughtError) {
    if (caughtError instanceof RateLimitError) {
      if (pathname.startsWith("/api/")) {
        return rateLimitErrorResponse(caughtError);
      }
      return new NextResponse("Too many requests. Please wait before trying again.", {
        status: 429,
        headers: {
          "Retry-After": String(caughtError.check.retryAfterSeconds ?? 60),
        },
      });
    }
    throw caughtError;
  }
}

export const config = {
  matcher: ["/api/:path*", "/m/:path*", "/join/:path*"],
};
