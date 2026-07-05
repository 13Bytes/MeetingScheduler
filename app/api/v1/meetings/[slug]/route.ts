import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getConvexUrl } from "@/lib/identity-internal";
import { readOptionalBearerTokenHash } from "@/lib/api/v1/auth";
import { apiErrorResponse, apiResponse, handleApiError } from "@/lib/api/v1/responses";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const tokenHash = await readOptionalBearerTokenHash(request);
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.query(api.agentApi.readMeeting, {
      tokenHash,
      slug,
    });
    if (!result) {
      return apiErrorResponse(404, "not_found", "The requested resource was not found.");
    }
    return apiResponse(result);
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
