import { ConvexHttpClient } from "convex/browser";
import { NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl, getInternalIdentitySecret } from "@/lib/identity-internal";
import {
  getIdentitySessionSecret,
  identitySessionCookieName,
  verifyEmailIdentitySession,
} from "@/lib/identity-session";
import { apiErrorResponse, apiResponse, handleApiError } from "@/lib/api/v1/responses";
import { parseCreateApiTokenBody, readJsonObject } from "@/lib/api/v1/schemas";

export async function POST(request: NextRequest) {
  try {
    const session = verifyEmailIdentitySession(
      request.cookies.get(identitySessionCookieName)?.value,
      getIdentitySessionSecret(),
    );
    if (!session) {
      return apiErrorResponse(
        401,
        "email_session_required",
        "A verified email session is required to create API tokens.",
      );
    }

    const body = parseCreateApiTokenBody(await readJsonObject(request));
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.agentApi.createApiToken, {
      internalSecret: getInternalIdentitySecret(),
      emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
      ...body,
    });
    return apiResponse({
      apiToken: result.apiToken,
      tokenFingerprint: result.tokenFingerprint,
      scopes: result.scopes,
      createdAt: result.createdAt,
    });
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
