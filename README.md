# Meeting Scheduler

A Stage 5 foundation for a Doodle-style collaborative scheduling app. The app is
set up as a deployable Next.js + TypeScript project with Convex for the realtime
backend layer, a typed domain model, Tailwind-based UI primitives, an anonymous
meeting creation flow, an admin calendar constraint painter, and participant
availability painting with live result recommendations.

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
ranking, and privacy-aware result display.

Core Convex tables:

- `meetings`: poll settings, lifecycle state, canonical timezone, granularity,
  duration, current allowed ranges, final slot metadata, and audit timestamps.
- `memberships`: every person-meeting relationship, including role,
  privacy mode, optional email identity, and hashed personal secret-link token.
- `allowedTimeRanges`: timezone-aware admin-defined windows for later calendar
  painting flows.
- `availabilityRecords`: per-membership cell responses of `yes`, `reluctant`,
  or `no` over allowed cells.
- `emailIdentities`: optional passwordless identity records normalized by email.
- `magicLinks`: hashed verification or recovery tokens with expiry and consume
  timestamps.
- `notificationOutbox`: placeholder outbox for later email delivery.
- `auditEvents`: append-only domain events for lifecycle and membership changes.

Key invariants:

- Anyone can create a poll; accounts are not required.
- Every participant, including each admin, is represented by a membership.
- Admin is a membership role. Multiple admins are allowed.
- Meetings can enable `everyoneAdmin`, where any active member can administer.
- Secret membership tokens are returned only at creation time. Magic-link issue
  requests queue a notification placeholder and return only a fingerprint until
  trusted out-of-band delivery exists. Convex stores SHA-256 hashes plus
  hash-derived fingerprints, never raw tokens.
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
| `/m/[meetingSlug]`        | Public participant join and response flow  |
| `/join/[membershipToken]` | Secret member return link and admin setup  |

## Meeting Creation Flow

`/new` lets an anonymous creator configure and create a meeting through the
Stage 1 Convex `createMeeting` mutation. The flow collects:

- title and optional description
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

Stage 5 still only recommends and visualizes. Admin finalization, passwordless
email identity UI, email notification delivery, cookie-backed anonymous
recovery, and AI-agent APIs remain deferred.

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

Reserved for later stages:

- `EMAIL_FROM`
- `EMAIL_PROVIDER_API_KEY`

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

## Stage Boundaries

Stage 5 intentionally does not implement organizer finalization workflow,
passwordless email identity UI, notification delivery, cookie-backed anonymous
recovery, or AI-agent APIs. The creation, admin-editing, participant return, and
results flows are link-based for now: each person must keep their personal
membership URL.
