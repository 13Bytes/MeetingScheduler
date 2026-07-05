# Agent API

Stage 9 exposes a versioned HTTP API for AI agents and external tools at
`/api/v1`. Membership secret links remain a separate web-user credential; API
tokens use the `ms_api_` prefix and are stored only as hashes in Convex.

## Authentication

Create API tokens from a verified passwordless email session:

```http
POST /api/v1/tokens
Content-Type: application/json

{
  "label": "Calendar planning agent",
  "scopes": [
    "meetings:create",
    "meetings:read",
    "availability:write",
    "recommendations:read",
    "meetings:finalize"
  ]
}
```

The response returns the raw `apiToken` once. Store it in the calling tool's
secret store and send it as `Authorization: Bearer ms_api_...`.

Available scopes: `meetings:create`, `meetings:read`, `availability:write`,
`recommendations:read`, and `meetings:finalize`.

Revoke a token from the same verified email session:

```http
DELETE /api/v1/tokens/{tokenFingerprint}
```

## Create A Meeting Poll

```http
POST /api/v1/meetings
Authorization: Bearer ms_api_...
Content-Type: application/json

{
  "title": "Research Sync",
  "description": "Find a time for the July planning session.",
  "creatorName": "Ada",
  "settings": {
    "canonicalTimeZone": "Europe/Berlin",
    "granularityMinutes": 30,
    "durationMinutes": 60,
    "allowedTimeRanges": [
      {
        "startUtc": "2026-07-06T09:00:00.000Z",
        "endUtc": "2026-07-06T12:00:00.000Z",
        "timeZone": "Europe/Berlin"
      }
    ]
  }
}
```

The creating email identity becomes the admin membership owner. The API response
does not expose a raw membership secret link.

## Retrieve Meeting State

Public reads are allowed without a bearer token and return privacy-filtered
results:

```http
GET /api/v1/meetings/research-sync
```

Authorized reads include the API identity's meeting capabilities when the
identity owns a membership in that meeting:

```http
GET /api/v1/meetings/research-sync
Authorization: Bearer ms_api_...
```

Summary-only meetings never expose individual `participantDetails` unless the
API token owner can administer that meeting.

## Submit Availability

First create a participant membership owned by the API identity:

```http
POST /api/v1/meetings/research-sync/participants
Authorization: Bearer ms_api_...
Content-Type: application/json

{
  "displayName": "Ada",
  "privacyMode": "detailed"
}
```

Then save or clear availability cells for that owned membership:

```http
PUT /api/v1/meetings/research-sync/participants/{membershipId}/availability
Authorization: Bearer ms_api_...
Content-Type: application/json

{
  "records": [
    {
      "startUtc": "2026-07-06T09:00:00.000Z",
      "endUtc": "2026-07-06T09:30:00.000Z",
      "response": "yes"
    },
    {
      "startUtc": "2026-07-06T09:30:00.000Z",
      "endUtc": "2026-07-06T10:00:00.000Z"
    }
  ]
}
```

Omitting `response` clears that cell. API tokens can only edit memberships owned
by the same verified email identity, and finalized meetings reject availability
writes until reopened.

## Get Recommendations

```http
GET /api/v1/meetings/research-sync/recommendations
Authorization: Bearer ms_api_...
```

This returns the same ranking model used by the web UI. Public requests are
allowed, but privacy filtering still applies.

## Finalize Or Reopen

Finalization and reopen require `meetings:finalize` plus admin authority for the
specific meeting. A generic API token is not a universal admin credential.

```http
POST /api/v1/meetings/research-sync/finalize
Authorization: Bearer ms_api_...
Content-Type: application/json

{
  "finalizedSlot": {
    "startUtc": "2026-07-06T09:00:00.000Z",
    "endUtc": "2026-07-06T10:00:00.000Z",
    "timeZone": "Europe/Berlin"
  }
}
```

```http
POST /api/v1/meetings/research-sync/reopen
Authorization: Bearer ms_api_...
```

## Error Shape

All API errors use a stable envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "settings.allowedTimeRanges must include at least one range."
  }
}
```

The OpenAPI document is available at `/api/v1/openapi.json`.
