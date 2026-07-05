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
  return apiErrorResponseForMessage(getErrorMessage(caughtError));
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
  if (/required|invalid|must|duplicate|already exists|outside/iu.test(message)) {
    return apiErrorResponse(400, "invalid_request", message);
  }
  return apiErrorResponse(
    503,
    "service_unavailable",
    "The API request could not be completed.",
  );
}

export function getErrorMessage(caughtError: unknown) {
  if (caughtError instanceof Error) {
    return caughtError.message;
  }
  return "Unknown API error";
}
