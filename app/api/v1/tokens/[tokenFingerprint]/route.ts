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

type RouteContext = {
  params: Promise<{ tokenFingerprint: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = verifyEmailIdentitySession(
      request.cookies.get(identitySessionCookieName)?.value,
      getIdentitySessionSecret(),
    );
    if (!session) {
      return apiErrorResponse(
        401,
        "email_session_required",
        "A verified email session is required to revoke API tokens.",
      );
    }

    const { tokenFingerprint } = await context.params;
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.agentApi.revokeApiToken, {
      internalSecret: getInternalIdentitySecret(),
      emailIdentityId: session.emailIdentityId as Id<"emailIdentities">,
      tokenFingerprint,
    });
    return apiResponse(result);
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
