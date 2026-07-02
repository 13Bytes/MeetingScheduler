# Convex Domain Model

Stage 1 defines the backend foundation for lightweight scheduling polls. Convex
is the source of truth for meetings, memberships, optional identity, secret-link
tokens, availability records, notifications, and audit events.

## Tables

- `meetings` stores the poll title, slug, lifecycle state, canonical timezone,
  granularity, duration, current allowed ranges, and final/reopen metadata.
- `memberships` stores each person's relationship to a meeting. The membership
  is the authority boundary for admin/member permissions and personal links.
- `membershipAccessTokens` stores additional hashed membership tokens minted by
  verified email recovery. These tokens do not replace the original membership
  token, so existing secret links remain valid.
- `allowedTimeRanges` stores timezone-aware windows that later admin calendar
  painting can refine.
- `availabilityRecords` stores cell-level `yes`, `reluctant`, or `no` responses
  by membership. Stage 4 participant painting writes and clears these records.
- `emailIdentities` stores optional normalized email identities for
  passwordless recovery.
- `magicLinks` stores verification and recovery tokens by hash with expiry and
  consume timestamps.
- `notificationOutbox` is a delivery placeholder for later email notifications.
- `auditEvents` records domain events for traceability.

## Token Strategy

Membership links and magic links are bearer secrets. Membership creation returns
the raw personal link token once. Magic-link issue requests queue a notification
placeholder and return only a fingerprint unless local development explicitly
enables dev magic-link exposure. The database stores:

- `tokenHash`: a SHA-256 hash with an application context prefix.
- `tokenFingerprint`: the first 16 characters of the hash digest for support
  and audit references.
- `tokenVersion` and timestamp fields for future rotation.

Lookup hashes the presented token and queries `by_token_hash`. Raw tokens should
not be logged, persisted, emailed via the outbox payload, or copied into audit
metadata.

Stage 4 displays a raw membership token only as part of the current user's own
personal `/join/[membershipToken]` link after joining or when they are already
using that link. Public meeting reads and membership-token reads never return raw
tokens from Convex.

Stage 7 recovery mints a new secondary membership token when a verified email
session asks to recover an attached membership. The raw recovered token is
returned once through the server route and only its hash/fingerprint are stored.
Magic links are consumed once and expired links cannot verify identity.

## Lifecycle and Permissions

Meetings have two persisted states: `open` and `finalized`. Reopening a meeting
sets the state back to `open` and increments `lifecycleRevision`, preserving the
fact that the poll was previously finalized through audit events and reopen
metadata.

Finalization requires an active admin and a selected slot. The slot is
normalized to the meeting's canonical timezone, must match the meeting duration,
must align to the granularity grid, and must still be fully covered by the
current allowed-time cells. Reopening clears the current `finalizedSlot` while
leaving availability records and meeting settings intact.

Permission helpers in `convex/domain/model.ts` enforce:

- Active admins can administer role-based meetings.
- Active members can administer when `adminMode` is `everyoneAdmin`.
- Revoked memberships have no capabilities.
- Any active member can edit availability while the meeting is open.
- Finalized meetings are read-only until an active admin reopens them.

Participant availability saves use the same lifecycle and membership checks.
Clearing a cell deletes that member's availability record for the cell; it does
not create a fourth persisted response value.

Finalization and reopening queue `notificationOutbox` placeholder rows for
active memberships with email identities. Stage 7 does not send production
email; the outbox only records enough metadata for a later delivery worker.

## Passwordless Identity

Email addresses are normalized and stored in `emailIdentities`. Verification
requires consuming a hashed `emailVerification` magic link before the identity
can be used for dashboard reads, membership attach, or link recovery.

Next.js owns the signed HttpOnly email session cookie. Server routes verify that
cookie, then call Convex identity functions with
`MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET`. Convex functions also re-check that
the identity is verified and that memberships are attached to the same identity.
Unverified email records may exist as optional hints from creation, but they do
not authorize recovery.

The built-in dev internal secret is accepted only when both the Next.js runtime
and the explicit local/dev Convex runtime set
`MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET=true`. Development magic-link
exposure also requires an explicit local/dev runtime plus
`MEETING_SCHEDULER_DEV_EXPOSE_MAGIC_LINKS=true`.

## Results and Privacy

Stage 5 result queries derive recommendations from existing meeting,
membership, and availability data. Candidate slots are generated from
admin-allowed cells using the meeting duration and granularity. A membership is
available for a candidate only if every covered cell is saved as `yes` or
`reluctant`; `no` and missing records both count as unavailable.

Ranking maximizes able participants first, minimizes reluctant covered-cell
votes second, and uses earliest start time as the deterministic tie-breaker.
Results are not persisted yet; Convex reads compute them from current records so
subscribed clients update as availability changes.

Detailed result payloads include participant display names and per-candidate
response details only when allowed. Admin-capable memberships can read details.
Non-admin memberships get details only when they are active, detailed-mode
members and every active participant is also detailed-mode. Public reads and
summary-only situations return aggregate scores only.

## Timezones and Cells

Meeting settings require a canonical IANA timezone. Allowed ranges and
availability cell helpers normalize instants to UTC strings while preserving the
timezone used to interpret the meeting rules. Granularity defaults to 30 minutes,
and duration must be a multiple of granularity.

## Local Convex

Run `npm run convex:dev` when a Convex project/deployment is configured. The
Convex CLI writes deployment values into `.env.local` and regenerates
`convex/_generated`.
