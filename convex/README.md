# Convex Domain Model

Stage 1 defines the backend foundation for lightweight scheduling polls. Convex
is the source of truth for meetings, memberships, optional identity, secret-link
tokens, availability records, notifications, and audit events.

## Tables

- `meetings` stores the poll title, slug, lifecycle state, canonical timezone,
  granularity, duration, current allowed ranges, and final/reopen metadata.
- `memberships` stores each person's relationship to a meeting. The membership
  is the authority boundary for admin/member permissions and personal links.
- `allowedTimeRanges` stores timezone-aware windows that later admin calendar
  painting can refine.
- `availabilityRecords` stores cell-level `yes`, `reluctant`, or `no` responses
  by membership. Later UI stages will write these records.
- `emailIdentities` stores optional normalized email identities for
  passwordless recovery.
- `magicLinks` stores verification and recovery tokens by hash with expiry and
  consume timestamps.
- `notificationOutbox` is a delivery placeholder for later email notifications.
- `auditEvents` records domain events for traceability.

## Token Strategy

Membership links and magic links are bearer secrets. Membership creation returns
the raw personal link token once. Magic-link issue requests queue a notification
placeholder and return only a fingerprint until a trusted out-of-band delivery
path exists. The database stores:

- `tokenHash`: a SHA-256 hash with an application context prefix.
- `tokenFingerprint`: the first 16 characters of the hash digest for support
  and audit references.
- `tokenVersion` and timestamp fields for future rotation.

Lookup hashes the presented token and queries `by_token_hash`. Raw tokens should
not be logged, persisted, emailed via the outbox payload, or copied into audit
metadata.

## Lifecycle and Permissions

Meetings have two persisted states: `open` and `finalized`. Reopening a meeting
sets the state back to `open` and increments `lifecycleRevision`, preserving the
fact that the poll was previously finalized through audit events and reopen
metadata.

Permission helpers in `convex/domain/model.ts` enforce:

- Active admins can administer role-based meetings.
- Active members can administer when `adminMode` is `everyoneAdmin`.
- Revoked memberships have no capabilities.
- Any active member can edit availability while the meeting is open.
- Finalized meetings are read-only until an active admin reopens them.

## Timezones and Cells

Meeting settings require a canonical IANA timezone. Allowed ranges and
availability cell helpers normalize instants to UTC strings while preserving the
timezone used to interpret the meeting rules. Granularity defaults to 30 minutes,
and duration must be a multiple of granularity.

## Local Convex

Run `npm run convex:dev` when a Convex project/deployment is configured. The
Convex CLI writes deployment values into `.env.local` and regenerates
`convex/_generated`.
