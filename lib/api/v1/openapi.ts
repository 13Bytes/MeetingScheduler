import { apiTokenScopes } from "./schemas";

const json = "application/json";

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Meeting Scheduler Agent API",
    version: "1.0.0",
    description:
      "Versioned API for creating and managing meeting polls with scoped API tokens.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerApiToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ms_api",
      },
      emailSessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "ms_email_session",
        description: "Verified passwordless email session cookie.",
      },
    },
    schemas: {
      Error: errorSchema,
      ApiTokenScope: { type: "string", enum: apiTokenScopes },
      ApiTokenCreateRequest: {
        type: "object",
        required: ["scopes"],
        properties: {
          label: { type: "string", maxLength: 80 },
          scopes: {
            type: "array",
            items: { $ref: "#/components/schemas/ApiTokenScope" },
            minItems: 1,
          },
        },
      },
      ApiTokenCreateResponse: {
        type: "object",
        required: ["apiToken", "tokenFingerprint", "scopes", "createdAt"],
        properties: {
          apiToken: { type: "string", description: "Returned once." },
          tokenFingerprint: { type: "string" },
          scopes: {
            type: "array",
            items: { $ref: "#/components/schemas/ApiTokenScope" },
          },
          createdAt: { type: "number" },
        },
      },
      ApiTokenRevokeResponse: {
        type: "object",
        required: ["tokenFingerprint", "revokedAt"],
        properties: {
          tokenFingerprint: { type: "string" },
          revokedAt: { type: "number" },
        },
      },
      AllowedTimeRange: {
        type: "object",
        required: ["startUtc", "endUtc"],
        properties: {
          startUtc: { type: "string", format: "date-time" },
          endUtc: { type: "string", format: "date-time" },
          timeZone: { type: "string" },
          label: { type: "string" },
        },
      },
      MeetingSettings: {
        type: "object",
        required: ["allowedTimeRanges"],
        properties: {
          canonicalTimeZone: { type: "string" },
          granularityMinutes: { type: "number" },
          durationMinutes: { type: "number" },
          allowedTimeRanges: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/AllowedTimeRange" },
          },
        },
      },
      MeetingCreateRequest: {
        type: "object",
        required: ["title", "settings"],
        properties: {
          title: { type: "string" },
          slug: { type: "string" },
          description: { type: "string" },
          creatorName: { type: "string" },
          creatorPrivacyMode: { type: "string", enum: ["detailed", "summaryOnly"] },
          settings: { $ref: "#/components/schemas/MeetingSettings" },
        },
      },
      MeetingCreateResponse: {
        type: "object",
        required: ["meetingId", "slug", "adminMembershipId", "tokenFingerprint"],
        properties: {
          meetingId: { type: "string" },
          slug: { type: "string" },
          adminMembershipId: { type: "string" },
          tokenFingerprint: { type: "string" },
        },
      },
      MeetingStateResponse: {
        type: "object",
        required: ["meeting", "viewer", "capabilities", "results"],
        properties: {
          meeting: { type: "object", additionalProperties: true },
          viewer: {
            anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
          },
          capabilities: { type: "object", additionalProperties: true },
          results: { $ref: "#/components/schemas/MeetingResults" },
        },
      },
      MeetingResults: {
        type: "object",
        required: ["detailsVisible", "candidates", "shortlist"],
        properties: {
          detailsVisible: { type: "boolean" },
          totalParticipantCount: { type: "number" },
          availabilityCount: { type: "number" },
          candidateCount: { type: "number" },
          candidates: { type: "array", items: { type: "object" } },
          shortlist: { type: "array", items: { type: "object" } },
        },
      },
      ParticipantCreateRequest: {
        type: "object",
        required: ["displayName"],
        properties: {
          displayName: { type: "string" },
          privacyMode: { type: "string", enum: ["detailed", "summaryOnly"] },
        },
      },
      ParticipantCreateResponse: {
        type: "object",
        required: ["meetingId", "membershipId", "displayName", "role"],
        properties: {
          meetingId: { type: "string" },
          membershipId: { type: "string" },
          displayName: { type: "string" },
          role: { type: "string", enum: ["member"] },
        },
      },
      AvailabilityRecordInput: {
        type: "object",
        required: ["startUtc", "endUtc"],
        properties: {
          startUtc: { type: "string", format: "date-time" },
          endUtc: { type: "string", format: "date-time" },
          timeZone: { type: "string" },
          response: { type: "string", enum: ["yes", "reluctant", "no"] },
          note: { type: "string" },
        },
      },
      AvailabilitySaveRequest: {
        type: "object",
        required: ["records"],
        properties: {
          records: {
            type: "array",
            items: { $ref: "#/components/schemas/AvailabilityRecordInput" },
          },
        },
      },
      AvailabilitySaveResponse: {
        type: "object",
        required: ["membershipId", "savedRecordIds", "clearedCellKeys"],
        properties: {
          membershipId: { type: "string" },
          savedRecordIds: { type: "array", items: { type: "string" } },
          clearedCellKeys: { type: "array", items: { type: "string" } },
        },
      },
      FinalizedSlot: {
        type: "object",
        required: ["startUtc", "endUtc"],
        properties: {
          startUtc: { type: "string", format: "date-time" },
          endUtc: { type: "string", format: "date-time" },
          timeZone: { type: "string" },
        },
      },
      FinalizeRequest: {
        type: "object",
        required: ["finalizedSlot"],
        properties: {
          finalizedSlot: { $ref: "#/components/schemas/FinalizedSlot" },
        },
      },
      LifecycleResponse: {
        type: "object",
        required: ["meetingId", "lifecycleState"],
        properties: {
          meetingId: { type: "string" },
          lifecycleState: { type: "string", enum: ["open", "finalized"] },
        },
      },
    },
  },
  paths: {
    "/tokens": {
      post: {
        security: [{ emailSessionCookie: [] }],
        summary: "Create an API token for the signed-in verified email identity",
        requestBody: requiredJson("#/components/schemas/ApiTokenCreateRequest"),
        responses: {
          "200": jsonResponse("#/components/schemas/ApiTokenCreateResponse"),
          "400": errorResponse(),
          "401": errorResponse(),
        },
      },
    },
    "/tokens/{tokenFingerprint}": {
      delete: {
        security: [{ emailSessionCookie: [] }],
        summary: "Revoke an API token owned by the signed-in verified identity",
        parameters: [pathParameter("tokenFingerprint")],
        responses: {
          "200": jsonResponse("#/components/schemas/ApiTokenRevokeResponse"),
          "401": errorResponse(),
          "404": errorResponse(),
        },
      },
    },
    "/meetings": {
      post: {
        security: [{ bearerApiToken: [] }],
        summary: "Create a meeting poll",
        requestBody: requiredJson("#/components/schemas/MeetingCreateRequest"),
        responses: {
          "201": jsonResponse("#/components/schemas/MeetingCreateResponse"),
          "400": errorResponse(),
          "401": errorResponse(),
          "403": errorResponse(),
        },
      },
    },
    "/meetings/{slug}": {
      get: {
        security: [{ bearerApiToken: [] }, {}],
        summary: "Read public or authorized meeting state",
        parameters: [pathParameter("slug")],
        responses: {
          "200": jsonResponse("#/components/schemas/MeetingStateResponse"),
          "401": errorResponse(),
          "403": errorResponse(),
          "404": errorResponse(),
        },
      },
    },
    "/meetings/{slug}/participants": {
      post: {
        security: [{ bearerApiToken: [] }],
        summary: "Create a participant membership owned by the API identity",
        parameters: [pathParameter("slug")],
        requestBody: requiredJson("#/components/schemas/ParticipantCreateRequest"),
        responses: {
          "201": jsonResponse("#/components/schemas/ParticipantCreateResponse"),
          "400": errorResponse(),
          "401": errorResponse(),
          "403": errorResponse(),
          "409": errorResponse(),
        },
      },
    },
    "/meetings/{slug}/participants/{membershipId}/availability": {
      put: {
        security: [{ bearerApiToken: [] }],
        summary: "Replace or clear availability cells for an owned membership",
        parameters: [pathParameter("slug"), pathParameter("membershipId")],
        requestBody: requiredJson("#/components/schemas/AvailabilitySaveRequest"),
        responses: {
          "200": jsonResponse("#/components/schemas/AvailabilitySaveResponse"),
          "400": errorResponse(),
          "401": errorResponse(),
          "403": errorResponse(),
          "404": errorResponse(),
          "409": errorResponse(),
        },
      },
    },
    "/meetings/{slug}/recommendations": {
      get: {
        security: [{ bearerApiToken: [] }, {}],
        summary: "Read ranked meeting recommendations",
        parameters: [pathParameter("slug")],
        responses: {
          "200": jsonResponse("#/components/schemas/MeetingResults"),
          "401": errorResponse(),
          "403": errorResponse(),
          "404": errorResponse(),
        },
      },
    },
    "/meetings/{slug}/finalize": {
      post: {
        security: [{ bearerApiToken: [] }],
        summary: "Finalize a meeting as an authorized admin",
        parameters: [pathParameter("slug")],
        requestBody: requiredJson("#/components/schemas/FinalizeRequest"),
        responses: {
          "200": jsonResponse("#/components/schemas/LifecycleResponse"),
          "400": errorResponse(),
          "401": errorResponse(),
          "403": errorResponse(),
          "409": errorResponse(),
        },
      },
    },
    "/meetings/{slug}/reopen": {
      post: {
        security: [{ bearerApiToken: [] }],
        summary: "Reopen a finalized meeting as an authorized admin",
        parameters: [pathParameter("slug")],
        responses: {
          "200": jsonResponse("#/components/schemas/LifecycleResponse"),
          "401": errorResponse(),
          "403": errorResponse(),
          "409": errorResponse(),
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "Machine-readable OpenAPI document",
        responses: { "200": { description: "OpenAPI document" } },
      },
    },
  },
} as const;

function pathParameter(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  };
}

function requiredJson(schemaRef: string) {
  return {
    required: true,
    content: {
      [json]: {
        schema: { $ref: schemaRef },
      },
    },
  };
}

function jsonResponse(schemaRef: string) {
  return {
    description: "Success",
    content: {
      [json]: {
        schema: { $ref: schemaRef },
      },
    },
  };
}

function errorResponse() {
  return {
    description: "Stable API error envelope",
    content: {
      [json]: {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}
