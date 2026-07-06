# Production Deployment

Stage 10 hardening keeps the app deployable as a small Next.js + Convex system.
The app is ready for real groups when the checklist below is completed for the
target environment.

## Required Services

- Next.js hosting that supports App Router route handlers and proxy files.
- A production Convex deployment.
- A transactional email provider. The current adapter supports Resend with
  `MEETING_SCHEDULER_EMAIL_PROVIDER=resend`.
- A stable public app origin such as `https://scheduler.example.com`.

## Environment Variables

Set these in the Next.js runtime:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`
- `CONVEX_DEPLOYMENT`
- `MEETING_SCHEDULER_APP_URL`
- `MEETING_SCHEDULER_IDENTITY_SESSION_SECRET`
- `MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET`
- `MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET`
- `EMAIL_FROM`
- `MEETING_SCHEDULER_EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` or `EMAIL_PROVIDER_API_KEY`

Set these in the Convex runtime:

- `MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET`
- `MEETING_SCHEDULER_DEV_EXPOSE_MAGIC_LINKS=false` or unset
- `MEETING_SCHEDULER_ALLOW_DEV_IDENTITY_SECRET=false` or unset

The identity internal secret must match between Next.js and Convex. Production
must not enable dev magic-link exposure or development email body logging.

## Commands

```bash
npm ci
npm run lint
npm run test
npm run format
npm run build
npm run convex:deploy
```

If Convex codegen or validation cannot reach the configured deployment from CI,
run it from a workstation with deployment credentials before release and record
the exact limitation in the release notes.

## Maintenance Jobs

Run the notification processor on a short schedule, for example every minute:

```bash
curl -X POST "$MEETING_SCHEDULER_APP_URL/api/notifications/process?limit=20" \
  -H "Authorization: Bearer $MEETING_SCHEDULER_NOTIFICATION_PROCESS_SECRET"
```

Run retention cleanup daily. Start with dry-run output, then run with
`dryRun:false` after reviewing counts:

```bash
npx convex run maintenance:cleanupRetainedData '{
  "internalSecret": "...",
  "dryRun": true,
  "limit": 50
}'
```

Default retention windows:

- Anonymous meetings with only anonymous memberships: 180 days.
- Inactive anonymous non-admin memberships with no availability: 180 days.
- Expired magic links: 7 days after expiry.
- Revoked API tokens and stale recovered membership access tokens: 90 days.
- Sent, failed, or cancelled notification records: 30 days.
- Expired rate-limit buckets: 2 days.

## Monitoring

The app intentionally avoids a heavyweight monitoring dependency at this stage.
Recommended hooks:

- Capture Next.js route errors and rejected route-handler promises in the hosting
  provider logs.
- Alert on repeated `429` spikes, notification processor failures, and any
  `internal_error` API envelope.
- Track Convex function failures for `meetings`, `agentApi`, and `maintenance`.
- Monitor email provider delivery, bounce, and suppression dashboards.

Do not send raw membership links, magic-link tokens, API bearer tokens, hashes,
or authorization headers to analytics or error reporting.

## Backup and Recovery

Convex is the source of truth. Schedule regular Convex exports or provider
backups before running destructive maintenance changes and before major
deployments.

Sensitive records include:

- `memberships`, `membershipAccessTokens`, `magicLinks`, and `apiTokens`
  because they contain bearer-token hashes and fingerprints.
- `emailIdentities` because they contain normalized email addresses.
- `notificationOutbox` because provider message ids and sanitized delivery
  errors can still be operationally sensitive.
- `auditEvents` because they describe membership and lifecycle actions.

Recovery should restore Convex data and environment secrets together. Rotating
`MEETING_SCHEDULER_IDENTITY_SESSION_SECRET` invalidates email dashboard sessions.
Rotating `MEETING_SCHEDULER_IDENTITY_INTERNAL_SECRET` requires updating both
Next.js and Convex at the same time.

## Known Risks

- In-memory Next.js proxy throttles are per runtime instance and only apply to
  traffic that reaches Next.js. Convex mutation throttles provide durable
  best-effort write protection, but anonymous clients can rotate local state.
  Public read/write limits should be supplemented by hosting or edge-provider
  rate limiting for large deployments.
- Browser-matrix verification must be repeated manually on Safari, Firefox,
  Chrome, and mobile touch devices before high-stakes use.
- Notification processing is pull-based. If the scheduled processor is not
  configured, queued lifecycle emails will not be delivered.
