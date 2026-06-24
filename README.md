# Meeting Scheduler

A Stage 1 foundation for a Doodle-style collaborative scheduling app. The app is
set up as a deployable Next.js + TypeScript project with Convex for the realtime
backend layer, a typed domain model, and Tailwind-based UI primitives for
calendar-heavy flows.

## Stack

- Next.js App Router with TypeScript
- Convex for realtime meetings, memberships, availability records, optional
  email identities, magic-link tokens, notifications, and audit events
- Tailwind CSS 4 with small local component primitives
- ESLint, Prettier, and Vitest

## Domain Model

Stage 1 defines the backend/domain foundation without shipping the full meeting
creation or availability painting UI.

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
- Secret membership and magic-link tokens are returned only at creation/issue
  time. Convex stores SHA-256 hashes plus hash-derived fingerprints, never raw
  tokens.
- Meeting lifecycle is `open -> finalized -> open` through explicit admin
  transitions. Finalized meetings are read-only until reopened.
- Meeting rules use a canonical IANA timezone and UTC-normalized range/cell
  boundaries. Granularity defaults to 30 minutes.
- Participants default to detailed availability visibility, with a
  `summaryOnly` privacy mode available for later UI enforcement.

## Routes

| Route                                 | Purpose                                    |
| ------------------------------------- | ------------------------------------------ |
| `/`                                   | Foundation overview and route entry points |
| `/new`                                | Future meeting creation flow               |
| `/m/[meetingSlug]`                    | Future public meeting poll                 |
| `/m/[meetingSlug]/admin/[adminToken]` | Future organizer route by secret link      |
| `/join/[membershipToken]`             | Future secret membership link route        |

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

Stage 1 intentionally does not implement the full meeting creation UI, admin
calendar painting, participant painting, recommendations, email delivery,
finalization screens, or AI-agent APIs. Those features should build on the
schema, domain helpers, core Convex functions, route map, and component
foundation introduced here.
