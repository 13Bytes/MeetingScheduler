import type { NextRequest } from "next/server";
import { hashSecretToken } from "@/convex/domain/tokens";
import { enforceRequestRateLimit, getClientIp } from "@/lib/rate-limit";
import { ApiRouteError } from "./responses";

export async function requireBearerTokenHash(request: Request | NextRequest) {
  const rawToken = readBearerToken(request);
  if (!rawToken) {
    await enforceRequestRateLimit({
      request,
      scope: "api.missing_bearer",
      key: getClientIp(request),
      limit: 30,
      windowMs: 60 * 1000,
    });
    throw new ApiRouteError(401, "missing_bearer", "Bearer API token is required.");
  }
  const tokenHash = await hashSecretToken(rawToken);
  await enforceRequestRateLimit({
    request,
    scope: "api.bearer",
    key: tokenHash,
    limit: 240,
    windowMs: 60 * 1000,
  });
  return tokenHash;
}

export async function readOptionalBearerTokenHash(request: Request | NextRequest) {
  const rawToken = readBearerToken(request);
  return rawToken ? await hashSecretToken(rawToken) : undefined;
}

function readBearerToken(request: Request | NextRequest) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim();
}
