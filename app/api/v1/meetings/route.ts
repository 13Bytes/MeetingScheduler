import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getConvexUrl } from "@/lib/identity-internal";
import { requireBearerTokenHash } from "@/lib/api/v1/auth";
import { apiResponse, handleApiError } from "@/lib/api/v1/responses";
import { parseCreateMeetingBody, readJsonObject } from "@/lib/api/v1/schemas";

export async function POST(request: Request) {
  try {
    const tokenHash = await requireBearerTokenHash(request);
    const body = parseCreateMeetingBody(await readJsonObject(request));
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.agentApi.createMeeting, {
      tokenHash,
      ...body,
    });
    return apiResponse(result, { status: 201 });
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
