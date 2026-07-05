import { apiResponse } from "@/lib/api/v1/responses";
import { openApiDocument } from "@/lib/api/v1/openapi";

export function GET() {
  return apiResponse(openApiDocument);
}
