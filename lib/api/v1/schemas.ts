import { apiTokenScopes, type ApiTokenScope } from "@/convex/domain/agentApi";
import {
  MAX_ALLOWED_RANGE_LABEL_LENGTH,
  MAX_ALLOWED_TIME_RANGES,
  MAX_AVAILABILITY_NOTE_LENGTH,
  MAX_MEETING_DESCRIPTION_LENGTH,
  type AvailabilityResponse,
  type PrivacyMode,
} from "@/convex/domain/model";
import { ApiRouteError } from "./responses";

export { apiTokenScopes };

export const maxAvailabilityRecordsPerRequest = 500;
export const maxApiJsonBytes = 256 * 1024;

export type AllowedTimeRangeInput = {
  startUtc: string;
  endUtc: string;
  timeZone?: string;
  label?: string;
};

export type MeetingSettingsInput = {
  canonicalTimeZone?: string;
  granularityMinutes?: number;
  durationMinutes?: number;
  allowedTimeRanges: AllowedTimeRangeInput[];
};

export async function readJsonObject(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxApiJsonBytes) {
      throw new ApiRouteError(413, "invalid_request", "Request body is too large.");
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxApiJsonBytes) {
      throw new ApiRouteError(413, "invalid_request", "Request body is too large.");
    }
    const parsed = JSON.parse(rawBody) as unknown;
    if (!isRecord(parsed)) {
      throw new ApiRouteError(400, "invalid_request", "JSON body must be an object.");
    }
    return parsed;
  } catch (caughtError) {
    if (caughtError instanceof ApiRouteError) {
      throw caughtError;
    }
    throw new ApiRouteError(400, "bad_json", "Request body must be valid JSON.");
  }
}

export function parseCreateApiTokenBody(body: Record<string, unknown>) {
  return {
    label: optionalString(body.label, "label"),
    scopes: parseScopes(body.scopes),
  };
}

export function parseCreateMeetingBody(body: Record<string, unknown>) {
  return {
    title: requiredString(body.title, "title"),
    slug: optionalString(body.slug, "slug"),
    description: optionalString(
      body.description,
      "description",
      MAX_MEETING_DESCRIPTION_LENGTH,
    ),
    creatorName: optionalString(body.creatorName, "creatorName"),
    creatorPrivacyMode: optionalPrivacyMode(body.creatorPrivacyMode),
    settings: parseMeetingSettings(body.settings),
  };
}

export function parseCreateParticipantBody(body: Record<string, unknown>) {
  return {
    displayName: requiredString(body.displayName, "displayName"),
    privacyMode: optionalPrivacyMode(body.privacyMode),
  };
}

export function parseAvailabilityBody(body: Record<string, unknown>) {
  const records = body.records;
  if (!Array.isArray(records)) {
    throw new ApiRouteError(400, "invalid_request", "records must be an array.");
  }
  if (records.length > maxAvailabilityRecordsPerRequest) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      `records must not exceed ${maxAvailabilityRecordsPerRequest} entries.`,
    );
  }
  return {
    records: records.map((record, index) => {
      if (!isRecord(record)) {
        throw new ApiRouteError(
          400,
          "invalid_request",
          `records[${index}] must be an object.`,
        );
      }
      return {
        startUtc: requiredString(record.startUtc, `records[${index}].startUtc`),
        endUtc: requiredString(record.endUtc, `records[${index}].endUtc`),
        timeZone: optionalString(record.timeZone, `records[${index}].timeZone`),
        response: optionalAvailabilityResponse(
          record.response,
          `records[${index}].response`,
        ),
        note: optionalString(
          record.note,
          `records[${index}].note`,
          MAX_AVAILABILITY_NOTE_LENGTH,
        ),
      };
    }),
  };
}

export function parseFinalizeBody(body: Record<string, unknown>) {
  const finalizedSlot = body.finalizedSlot;
  if (!isRecord(finalizedSlot)) {
    throw new ApiRouteError(400, "invalid_request", "finalizedSlot must be an object.");
  }
  return {
    finalizedSlot: {
      startUtc: requiredString(finalizedSlot.startUtc, "finalizedSlot.startUtc"),
      endUtc: requiredString(finalizedSlot.endUtc, "finalizedSlot.endUtc"),
      timeZone: optionalString(finalizedSlot.timeZone, "finalizedSlot.timeZone"),
    },
  };
}

function parseScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value)) {
    throw new ApiRouteError(400, "invalid_request", "scopes must be an array.");
  }
  const scopes = value.map((scope, index) => {
    if (!apiTokenScopes.includes(scope as ApiTokenScope)) {
      throw new ApiRouteError(
        400,
        "invalid_request",
        `scopes[${index}] is not a supported API scope.`,
      );
    }
    return scope as ApiTokenScope;
  });
  if (scopes.length === 0) {
    throw new ApiRouteError(400, "invalid_request", "At least one scope is required.");
  }
  return Array.from(new Set(scopes));
}

function parseMeetingSettings(value: unknown): MeetingSettingsInput {
  if (!isRecord(value)) {
    throw new ApiRouteError(400, "invalid_request", "settings must be an object.");
  }
  const allowedTimeRanges = value.allowedTimeRanges;
  if (!Array.isArray(allowedTimeRanges) || allowedTimeRanges.length === 0) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      "settings.allowedTimeRanges must include at least one range.",
    );
  }
  if (allowedTimeRanges.length > MAX_ALLOWED_TIME_RANGES) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      `settings.allowedTimeRanges must not exceed ${MAX_ALLOWED_TIME_RANGES} entries.`,
    );
  }
  return {
    canonicalTimeZone: optionalString(value.canonicalTimeZone, "canonicalTimeZone"),
    granularityMinutes: optionalNumber(value.granularityMinutes, "granularityMinutes"),
    durationMinutes: optionalNumber(value.durationMinutes, "durationMinutes"),
    allowedTimeRanges: allowedTimeRanges.map((range, index) => {
      if (!isRecord(range)) {
        throw new ApiRouteError(
          400,
          "invalid_request",
          `settings.allowedTimeRanges[${index}] must be an object.`,
        );
      }
      return {
        startUtc: requiredString(
          range.startUtc,
          `settings.allowedTimeRanges[${index}].startUtc`,
        ),
        endUtc: requiredString(
          range.endUtc,
          `settings.allowedTimeRanges[${index}].endUtc`,
        ),
        timeZone: optionalString(
          range.timeZone,
          `settings.allowedTimeRanges[${index}].timeZone`,
        ),
        label: optionalString(
          range.label,
          `settings.allowedTimeRanges[${index}].label`,
          MAX_ALLOWED_RANGE_LABEL_LENGTH,
        ),
      };
    }),
  };
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiRouteError(400, "invalid_request", `${name} is required.`);
  }
  return value;
}

function optionalString(value: unknown, name: string, maxLength?: number) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ApiRouteError(400, "invalid_request", `${name} must be a string.`);
  }
  if (maxLength !== undefined && value.trim().length > maxLength) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      `${name} must be ${maxLength} characters or fewer.`,
    );
  }
  return value;
}

function optionalNumber(value: unknown, name: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiRouteError(400, "invalid_request", `${name} must be a number.`);
  }
  return value;
}

function optionalPrivacyMode(value: unknown): PrivacyMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== "detailed" && value !== "summaryOnly") {
    throw new ApiRouteError(
      400,
      "invalid_request",
      "privacyMode must be detailed or summaryOnly.",
    );
  }
  return value;
}

function optionalAvailabilityResponse(
  value: unknown,
  name: string,
): AvailabilityResponse | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== "yes" && value !== "reluctant" && value !== "no") {
    throw new ApiRouteError(
      400,
      "invalid_request",
      `${name} must be yes, reluctant, no, or omitted.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
