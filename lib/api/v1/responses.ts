import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "bad_json"
  | "email_session_required"
  | "invalid_request"
  | "missing_bearer"
  | "invalid_token"
  | "insufficient_scope"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error"
  | "service_unavailable";

export class ApiRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function apiResponse<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function apiErrorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function handleApiError(caughtError: unknown) {
  if (caughtError instanceof ApiRouteError) {
    return apiErrorResponse(caughtError.status, caughtError.code, caughtError.message);
  }
  const message = getErrorMessage(caughtError);
  const response = apiErrorResponseForMessage(message);
  if (response.status >= 500) {
    console.error("Agent API request failed", caughtError);
  }
  return response;
}

export function apiErrorResponseForMessage(message: string) {
  if (/api token is invalid or revoked/iu.test(message)) {
    return apiErrorResponse(401, "invalid_token", "Invalid or revoked API token.");
  }
  if (/missing required scope/iu.test(message)) {
    return apiErrorResponse(
      403,
      "insufficient_scope",
      "The API token is missing a required scope.",
    );
  }
  if (/not found/iu.test(message)) {
    return apiErrorResponse(404, "not_found", "The requested resource was not found.");
  }
  if (/read-only|finalized meetings/iu.test(message)) {
    return apiErrorResponse(
      409,
      "conflict",
      "The meeting lifecycle does not allow this write.",
    );
  }
  if (/cannot administer|only an active admin|cannot edit availability/iu.test(message)) {
    return apiErrorResponse(
      403,
      "forbidden",
      "The API token is not authorized for this action.",
    );
  }
  if (/duplicate|already exists/iu.test(message)) {
    return apiErrorResponse(409, "conflict", "The requested resource already exists.");
  }
  if (/MEETING_SCHEDULER_|NEXT_PUBLIC_CONVEX_URL|internal identity/iu.test(message)) {
    return apiErrorResponse(
      500,
      "internal_error",
      "The API request could not be completed.",
    );
  }
  if (/required|invalid|must|outside/iu.test(message)) {
    return apiErrorResponse(400, "invalid_request", message);
  }
  return apiErrorResponse(
    500,
    "internal_error",
    "The API request could not be completed.",
  );
}

export function getErrorMessage(caughtError: unknown) {
  if (caughtError instanceof Error) {
    return caughtError.message;
  }
  return "Unknown API error";
}
