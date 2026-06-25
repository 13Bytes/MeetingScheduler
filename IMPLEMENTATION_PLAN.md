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
2. **Stage 1: Domain Model and Core Functions**
   - Add Convex tables, domain validation, permission helpers, lifecycle
     transitions, token handling, and foundational mutations/queries.
3. **Stage 2: Meeting Creation**
   - Replace `/new` with a usable anonymous meeting creation form.
   - Generate broad allowed time ranges from shortcuts instead of implementing
     the final calendar painter.
   - Connect the UI to the Stage 1 Convex creation function.
   - Show the creator's personal admin membership link and public participant
     link after creation.
   - Keep cookie-backed anonymous recovery for a later stage.
4. **Stage 3: Admin Calendar Constraint Painter**
   - Replace the membership-link placeholder with the admin setup/editing view.
   - Let admins paint broad allowed and blocked calendar regions using the
     meeting timezone, duration, and granularity.
   - Persist allowed ranges through the existing Convex settings/domain layer.
   - Keep participant availability painting, recommendations, and finalization
     UI for later stages.
5. **Stage 4: Availability Collaboration**
   - Add realtime availability painting and participant state inside the
     admin-allowed cells.
6. **Stage 5: Finalization and Notifications**
   - Add organizer finalization and email notifications.
7. **Stage 6: Agent-Friendly APIs**
   - Expose safe API surfaces for external assistants and automations.
