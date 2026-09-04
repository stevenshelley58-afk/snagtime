# Blockwise Booking integration

This fork keeps SnagTime's MIT license and upstream behavior by default. Set
`FREE_ONLY=true` for a Blockwise free-only deployment. The frontend build
receives the same value as a build argument; the server gate is authoritative: paid event publication, paid
booking creation, Stripe Checkout, Stripe webhooks, and upgrade/payment UI are
disabled. Existing upstream deployments should leave both values unset or
`false`.

## Canonical booking URL

The hosted Blockwise service uses `https://book.blockwise.sale` as its
canonical booking origin. Set this exact value in the runtime environment:

```dotenv
NEXT_PUBLIC_APP_URL="https://book.blockwise.sale"
```

This value is the base for public booking links, manage links, email recovery
links, and the Google OAuth callback. Configure the Google OAuth redirect URI
as `https://book.blockwise.sale/api/integrations/google/callback`; the origin
must not include a path, query, or fragment.

## Signed lifecycle events

When `BLOCKWISE_WEBHOOK_URL` is configured, each committed booking transition
creates one durable `IntegrationOutbox` row. The exact persisted body is:

```json
{
  "spec":"blockwise.booking.v1",
  "id":"<immutable UUID>",
  "type":"booking.created|booking.rescheduled|booking.cancelled",
  "occurredAt":"<UTC ISO-8601 timestamp>",
  "data": {
    "booking":{"uid":"…", "eventTypeId":"…", "startTime":"…",
      "endTime":"…", "rescheduleUrl":null},
    "invitation":"…",
    "attendee":{"name":"…","email":"…"}
  }
}
```

The raw JSON body is signed with HMAC-SHA-256 over
`<unix-timestamp>.<raw-body>`. Requests include
`X-SnagTime-Timestamp`, `X-SnagTime-Event-Id`, and
`X-SnagTime-Signature: sha256=<hex>`. Consumers should reject timestamps more
than five minutes from their clock and deduplicate by the envelope `id`.
The worker retries failures with bounded exponential backoff and marks the
row `DEAD` after the existing integration attempt limit; no secret is stored
in the repository or payload. `blockwiseReference` is an opaque invitation
reference only; a client-supplied workspace identifier is never accepted.

Run the normal migration before enabling delivery:

```bash
npm run db:migrate
npm run db:migrate:postgres
```

Rollback is fix-forward: disable `BLOCKWISE_WEBHOOK_URL`, drain or inspect
pending rows, and deploy the prior application while retaining the additive
columns. Do not delete outbox rows until Blockwise confirms receipt.

## Deployment/readiness

Set `BLOCKWISE_WEBHOOK_SECRET` from a runtime secret manager (at least 32
bytes); generate it with `openssl rand -base64 32` or the equivalent platform
secret generator. Production destinations must use HTTPS. The normal Docker
web and dedicated worker services are required so the durable outbox drains;
readiness must include database migration status, worker heartbeat, and the
age/count of pending or dead `BLOCKWISE_BOOKING_EVENT` rows. Never put the
secret in a Dockerfile, image layer, `.env` committed to Git, or logs.

The free-only Compose contract wires `BLOCKWISE_WEBHOOK_URL` into both web and
worker services and mounts the external `blockwise_webhook_secret`. Create
that runtime secret before startup, then set the HTTPS destination URL:

```bash
printf '%s' "$(openssl rand -base64 32)" | docker secret create blockwise_webhook_secret -
```

## Upstream receipt and attribution

Pinned upstream receipt for this package: `nateherkai/snagtime` default branch
`main` at `1c95490a4bfb498084fcb8295439befe194c229a` (MIT License), with open
upstream PR #1 from `damian123/snagtime` at
`099a82327f71e1c832f23df6deba33dfa952ee07`. The PR's production tenant
context fix is included as a separate commit on this branch so it can be
reconciled upstream. Blockwise-specific free-only and signed-event changes
should be proposed as a separate draft PR in the fork first; upstream should
receive only the generally useful tenant-context hardening and tests.
