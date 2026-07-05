import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexUrl } from "@/lib/identity-internal";
import { requireBearerTokenHash } from "@/lib/api/v1/auth";
import { apiResponse, handleApiError } from "@/lib/api/v1/responses";
import { parseAvailabilityBody, readJsonObject } from "@/lib/api/v1/schemas";

type RouteContext = {
  params: Promise<{ slug: string; membershipId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { slug, membershipId } = await context.params;
    const tokenHash = await requireBearerTokenHash(request);
    const body = parseAvailabilityBody(await readJsonObject(request));
    const convex = new ConvexHttpClient(getConvexUrl());
    const result = await convex.mutation(api.agentApi.saveAvailability, {
      tokenHash,
      meetingSlug: slug,
      membershipId: membershipId as Id<"memberships">,
      records: body.records,
    });
    return apiResponse(result);
  } catch (caughtError) {
    return handleApiError(caughtError);
  }
}
