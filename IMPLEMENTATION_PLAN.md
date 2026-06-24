# Implementation Plan

## Product Direction

Build a Doodle-style scheduling application with a more polished UI, no required
accounts, secret membership links, optional passwordless email identity, realtime
collaboration, and later AI-agent-friendly APIs.

## Stack Direction

- Next.js and TypeScript for the web app
- Convex as the primary realtime backend and data layer
- Tailwind CSS plus local component primitives for calendar-heavy UI

## Stages

1. **Stage 0: Project Foundation**
   - Scaffold the deployable app structure.
   - Configure Convex local development basics.
   - Add Tailwind and a compact UI foundation.
   - Add linting, formatting, tests, route placeholders, and environment docs.
2. **Stage 1: Meeting Creation**
   - Add meeting creation forms, Convex tables, validation, and secret links.
3. **Stage 2: Availability Collaboration**
   - Add realtime availability painting and participant state.
4. **Stage 3: Finalization and Notifications**
   - Add organizer finalization and email notifications.
5. **Stage 4: Agent-Friendly APIs**
   - Expose safe API surfaces for external assistants and automations.
