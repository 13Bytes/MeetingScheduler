import type { NextRequest } from "next/server";
import { hashSecretToken } from "@/convex/domain/tokens";
import { ApiRouteError } from "./responses";

export async function requireBearerTokenHash(request: Request | NextRequest) {
  const rawToken = readBearerToken(request);
  if (!rawToken) {
    throw new ApiRouteError(401, "missing_bearer", "Bearer API token is required.");
  }
  return await hashSecretToken(rawToken);
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
