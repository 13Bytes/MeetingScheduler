# Meeting Scheduler

A Stage 8 foundation for a Doodle-style collaborative scheduling app. The app is
set up as a deployable Next.js + TypeScript project with Convex for the realtime
backend layer, a typed domain model, Tailwind-based UI primitives, an anonymous
meeting creation flow, an admin calendar constraint painter, and participant
availability painting with live result recommendations, admin finalization, and
optional passwordless email recovery, and transactional email notifications.

## Stack

- Next.js App Router with TypeScript
- Convex for realtime meetings, memberships, availability records, optional
  email identities, magic-link tokens, notifications, and audit events
- Tailwind CSS 4 with small local component primitives
- ESLint, Prettier, and Vitest

## Domain Model

Stage 1 defines the backend/domain foundation. Stage 2 adds the first
user-facing creation flow. Stage 3 adds the admin setup/editing experience for
painting broad allowed candidate time regions. Stage 4 adds the participant
join/return flow for painting yes, reluctant, no, or unset availability over
admin-allowed cells. Stage 5 adds realtime candidate scoring, recommendation
ranking, and privacy-aware result display. Stage 6 adds admin final selection,
selected-slot display, and reopening. Stage 7 adds optional passwordless email
identity for recovery. Stage 8 adds transactional email delivery for
passwordless verification and meeting lifecycle notifications.

Core Convex tables:

- `meetings`: poll settings, lifecycle state, canonical timezone, granularity,
  duration, current allowed ranges, final slot metadata, and audit timestamps.
- `memberships`: every person-meeting relationship, including role,
  privacy mode, optional email identity, and hashed personal secret-link token.
- `membershipAccessTokens`: additional hashed membership bearer tokens minted
  for verified email recovery, without invalidating existing secret links.
- `allowedTimeRanges`: timezone-aware admin-defined windows for later calendar
  painting flows.
- `availabilityRecords`: per-membership cell responses of `yes`, `reluctant`,
  or `no` over allowed cells.
- `emailIdentities`: optional passwordless identity records normalized by email.
- `magicLinks`: hashed verification or recovery tokens with expiry and consume
  timestamps.
- `notificationOutbox`: retryable email delivery records with dedupe keys,
  attempts, provider status, sent timestamps, and delivery errors.
- `auditEvents`: append-only domain events for lifecycle and membership changes.

Key invariants:

- Anyone can create a poll; accounts are not required.
- Every participant, including each admin, is represented by a membership.
- Admin is a membership role. Multiple admins are allowed.
- Meetings can enable `everyoneAdmin`, where any active member can administer.
- Secret membership tokens are returned only at creation time. Magic-link issue
  requests send through the server email adapter and return only a fingerprint
  unless local development explicitly enables dev magic-link exposure. Convex
  stores SHA-256 hashes plus hash-derived fingerprints, never raw tokens.
- Email identity is optional. A verified email can attach to memberships for
  recovery, but it does not replace memberships and is never required to create
  or answer a poll.
- Verified email dashboard access is backed by a signed, HttpOnly, SameSite=Lax
  session cookie. Server routes authorize dashboard and attach/recover actions
  before calling Convex with an internal identity secret.
- Meeting lifecycle is `open -> finalized -> open` through explicit admin
  transitions. Finalized meetings are read-only until reopened.
- Meeting rules use a canonical IANA timezone and UTC-normalized range/cell
  boundaries. Granularity defaults to 30 minutes.
- Participants default to detailed availability visibility, with a
  `summaryOnly` privacy mode available for later UI enforcement.

## Routes

| Route                     | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `/`                       | Foundation overview and route entry points |
| `/new`                    | Anonymous meeting creation flow            |
| `/identity`               | Optional passwordless email verification   |
| `/identity/dashboard`     | Verified email recovery dashboard          |
| `/m/[meetingSlug]`        | Public participant join and response flow  |
| `/join/[membershipToken]` | Secret member return link and admin setup  |

## Meeting Creation Flow

`/new` lets an anonymous creator configure and create a meeting through the
Stage 1 Convex `createMeeting` mutation. The flow collects:

- title and optional description
- optional recovery email
- canonical IANA timezone
- meeting duration and slot granularity
- creator availability privacy mode
- role-based or everyone-admin administration mode
- broad allowed-time ranges through presets

The currently supported allowed-time shortcuts are:

- weekdays 09:00-17:00 for the next two weeks
- the next 10 days from 10:00-16:00
- a modest custom daily range with date, time, and weekend controls

After Convex creates the meeting and creator membership, the page displays two
copyable links:

- the creator's personal admin membership link at `/join/[membershipToken]`
- the public participant link at `/m/[meetingSlug]`

Admin access uses the same membership-secret-link model as every other
person-meeting relationship. There is no separate admin token model.

## Passwordless Email Recovery

Stage 7 adds optional email identity at `/identity` and in the membership
sidebar. Users can request a passwordless magic link for a normalized email
address. Consuming the link through `/identity/verify?token=...` marks the
identity verified, consumes the hashed magic-link token once, and sets a signed
HttpOnly session cookie.

Verified users can attach the signed-in email identity to a membership they
already control through its secret membership link. Memberships created with an
optional email become recoverable after that same normalized email is verified.
The recovery dashboard at `/identity/dashboard` lists only active memberships
attached to the verified identity where the user is an admin or has submitted
availability.

Because raw membership tokens are not stored, recovery creates a new hashed
secondary membership access token and shows the recovered `/join/[token]` link
once. Existing secret membership links remain valid and independent of email
login. Unverified email addresses never unlock dashboard rows or membership
actions.

Magic-link requests create `notificationOutbox` rows containing only non-secret
metadata, then the Next.js route sends the raw link immediately through the
configured email adapter. The raw magic-link token is not stored in Convex or in
the outbox payload. For local development only, set
`MEETING_SCHEDULER_DEV_EXPOSE_MAGIC_LINKS=true` in the Convex runtime to let the
request API return a clickable dev magic link. Do not enable that flag in
production.

## Admin Calendar Constraint Painter

`/join/[membershipToken]` resolves the membership token through Convex and shows
the Stage 3 admin painter when the membership can administer the meeting. Admin
permission comes from the membership role and the meeting's `everyoneAdmin`
setting. The raw membership token is not rendered in the page.

The painter lets admins:

- review meeting title, lifecycle state, canonical timezone, duration, and
  granularity
- paint broad allowed or blocked regions on a stable responsive calendar grid
- use brush controls for allow, block/erase, and preview selection
- fill weekday business hours, clear weekends, clear weekday mornings or
  afternoons, and clear all painted cells
- save painted cells back to Convex through `updateMeetingSettings`

The grid is generated from the meeting timezone, granularity, duration, and
existing allowed ranges. Stage 2 custom presets are bounded to 42 days so admins
do not land on unmanageably large paint surfaces. Conversion helpers keep UI
cells and stored `allowedTimeRanges` aligned to timezone-aware UTC instants.
Client validation warns when painted regions are empty or too short for the full
meeting duration, while the Convex domain normalization remains authoritative.

Non-admin memberships can view the constraints but cannot edit them. Finalized
meetings are read-only until reopened by the backend lifecycle flow.

## Participant Availability Painter

`/m/[meetingSlug]` loads public meeting details and the admin-allowed calendar
cells. A visitor can paint locally first, but must enter a display name before
the first persisted availability write. Saving creates a regular member
membership through the Stage 1 token model, writes that participant's cell-level
availability records, and displays a copyable personal `/join/[membershipToken]`
link for returning later.

`/join/[membershipToken]` resolves a secret membership link and shows only that
participant's own saved response for editing. Admin memberships land on the same
response editor first and can open the Stage 3 admin setup painter from an admin
access panel. Admin remains a membership role; there is still no separate admin
token model.

The participant grid is derived from the meeting's canonical timezone,
granularity, duration, and admin-allowed ranges. Only admin-allowed cells are
paintable. Brush modes are `yes`, `reluctant`, `no`, and clear/unset, with drag
painting and keyboard cell toggles. Convex validation remains authoritative:
saves require an active membership, an open meeting, grid-aligned cell
boundaries, and cells inside the allowed ranges. Finalized polls are read-only
until reopened.

## Realtime Results and Recommendations

Stage 5 derives candidate meeting slots from the admin-allowed cell ranges using
the meeting duration and granularity. A participant counts as available for a
candidate only when every covered cell is `yes` or `reluctant`; any `no` or
unset cell makes that participant unavailable for that candidate.

Candidates are ranked by:

1. Most participants able to attend, where `yes` and `reluctant` both count.
2. Fewest reluctant votes across the covered candidate cells.
3. Earliest start time as a stable tie-breaker.

Convex meeting reads include derived results built from current memberships and
availability records, so public and membership views update as responses change.
The participant screen shows a recommended shortlist and compact score heatmap.
Membership/admin views can show participant names and individual details when
privacy permits. Public viewers and summary-only participant views receive
aggregate counts and scores only; admins can see details when their membership
has admin capability.

Stage 6 builds on these live recommendations with the finalization and reopening
flow below.

## Finalization and Reopening

Stage 6 lets admin-capable memberships choose a final meeting time from the
recommended shortlist or override to any currently valid candidate slot. The
confirmation panel shows the timezone-aware start/end window, duration, rank,
attendee count, reluctant-cell count, and meeting timezone before the admin
finalizes.

The Convex `finalizeMeeting` mutation requires an active admin membership and an
open meeting. It revalidates the selected slot against the current meeting
duration, granularity, canonical timezone, and allowed-time cells so stale
client candidates cannot be finalized after constraints change. The selected
slot is stored on the meeting, the lifecycle moves to `finalized`, and public,
member, and admin views show the final time while keeping results readable.

Finalized polls are read-only: participant availability painting, public
joining, and admin constraint painting are disabled until an admin uses
`reopenMeeting`. Reopening moves the lifecycle back to `open`, clears the current
final slot, records reopen metadata/audit events, and preserves existing
availability and settings for continued editing.

When finalized or reopened, Convex queues `notificationOutbox` records only for
active memberships attached to verified email identities. The dedupe key is
scoped to the meeting, lifecycle revision, event kind, and email identity, so one
verified recipient is not emailed twice for the same logical lifecycle event.
Call `POST /api/notifications/process` to claim queued rows and deliver them
through the configured email adapter. AI-agent APIs remain deferred.

## Environment

Copy `.env.example` to `.env.local` for local development. Convex will populate
its own values when you run the local dev command.

```bash
cp .env.example .env.local
npm run convex:dev
```

Required for Convex-backed features:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`
- `MEETING_SCHEDULER_IDENTITY_SESSION_SECRET` for signing email identity session
  cookies in production. Local development falls back to a dev-only secret.
- `MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET` shared by Next server routes and
  Convex for email dashboard/attach/recover operations in production.
- `EMAIL_FROM` for production email delivery.
- `MEETING_SCHEDULER_EMAIL_PROVIDER=resend` plus `RESEND_API_KEY` or
  `EMAIL_PROVIDER_API_KEY` for Resend delivery. Production defaults to Resend
  when no provider is set.
- `MEETING_SCHEDULER_APP_URL` for absolute links in passwordless and background
  lifecycle notifications.
- `MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET` protects
  `POST /api/notifications/process` in production. Send it as
  `Authorization: Bearer <secret>`.

Optional local-development identity helper:

- `MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET=true` in both the Next.js and
  explicit local/dev Convex runtimes enables the built-in dev internal secret.
  Prefer setting the real internal secret in both runtimes when possible.
- `MEETING_SCHEDULER_DEV_EXPOSE_MAGIC_LINKS=true` in the Convex runtime returns
  raw dev magic-link URLs from the request API. This is unsafe for production and
  should only be used on a local machine.
- `MEETING_SCHEDULER_EMAIL_PROVIDER=development` forces the development email
  adapter. Non-production defaults to this adapter.
- `MEETING_SCHEDULER_EMAIL_DEV_LOG_CONTENT=true` logs local email bodies to the
  server console. Leave unset unless you explicitly need to inspect a local email
  body.

Development email delivery stores messages in memory for tests and logs only the
recipient, subject, and local provider message id by default. Production must not
enable dev magic-link exposure or dev email body logging.

## Development

Use Node.js 22 or newer and npm 10 or newer. Stage 0 was verified with Node
24.13.1 and npm 11.8.0.

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Run Convex locally:

```bash
npm run convex:dev
```

Convex codegen and live validation require a configured `CONVEX_DEPLOYMENT`.
Without that environment value, `npx convex codegen` exits with
`No CONVEX_DEPLOYMENT set` before checking the local functions.
Stage 9 verification in isolated worktrees may also be unable to run codegen
when outbound Convex access is blocked; in that case build/type checks require
local ignored `convex/_generated` stubs or a configured deployment, and the
limitation should be called out in PR notes.

Lint:

```bash
npm run lint
```

Format check:

```bash
npm run format
```

Test:

```bash
npm run test
```

Build:

```bash
npm run build
```

## Agent API

Stage 9 adds an agent-friendly HTTP API under `/api/v1`. Agents authenticate
with scoped `ms_api_...` bearer tokens created from a verified email identity;
membership secret links remain distinct and are not API credentials. API tokens
are hashed in Convex, can be revoked by fingerprint, and do not grant universal
admin rights. Finalize/reopen operations still require that the token owner has
admin authority for the specific meeting.

The machine-readable API description is served from `/api/v1/openapi.json`.
Developer examples for creating polls, reading state, submitting availability,
reading recommendations, and finalizing meetings are in `docs/API.md`.

## Stage Boundaries

Stage 9 intentionally keeps the agent API focused on authenticated poll
management. It does not implement webhook verification, provider-specific bounce
handling, or a notification management console. Passwordless identity is
recovery and API-token ownership only: accounts are not required, passwords do
not exist, and membership secret links remain the primary direct access
credential for normal web users.
