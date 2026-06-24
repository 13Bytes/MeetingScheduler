# Meeting Scheduler

A Stage 0 foundation for a Doodle-style collaborative scheduling app. The app is
set up as a deployable Next.js + TypeScript project with Convex for the realtime
backend layer and Tailwind-based UI primitives for calendar-heavy flows.

## Stack

- Next.js App Router with TypeScript
- Convex for realtime data, memberships, availability, finalization, identities,
  and notifications in later stages
- Tailwind CSS 4 with small local component primitives
- ESLint, Prettier, and Vitest

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

Stage 0 intentionally does not implement meeting creation, authentication,
availability painting, recommendations, finalization, notifications, or AI-agent
APIs. Those features should build on the route map, Convex setup, and component
foundation introduced here.
