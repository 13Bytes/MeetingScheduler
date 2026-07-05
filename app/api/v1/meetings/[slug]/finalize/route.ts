import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getConvexUrl } from "@/lib/identity-internal";
import { requireBearerTokenHash } from "@/lib/api/v1/auth";
import { apiResponse, handleApiError } from "@/lib/api/v1/responses";
import { parseFinalizeBody, readJsonObject } from "@/lib/api/v1/schemas";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const tokenHash = await requireBearerTokenHash(request);
    const body = parseFinalizeBody(await readJsonObject(request));
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.agentApi.finalizeMeeting, {
      tokenHash,
      meetingSlug: slug,
      finalizedSlot: body.finalizedSlot,
    });
    return apiResponse(result);
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
