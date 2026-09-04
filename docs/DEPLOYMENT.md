# Deployment guide

## Choose the right deployment shape

SnagTime is a stateful Next.js application with API routes, a relational database, OAuth callbacks, webhooks, and asynchronous calendar and email work.

It cannot be deployed as static files. ChatGPT Sites is not compatible with this application. Vercel is not supported out of the box because the audited production design requires a continuously running worker and role-separated PostgreSQL connections.

Use infrastructure that supports:

- A long-running Node.js web container
- A separate long-running worker container
- PostgreSQL 18 with persistent storage and verified TLS
- HTTPS ingress with a stable domain
- Runtime secret injection
- Scheduled encrypted backups

A Linux VPS with Docker is the most direct fit. Container platforms can also work if they provide all of the capabilities above, but the included production Compose file is a reference deployment contract, not a one-click template for a particular vendor.

## Local versus production

| Area | Local demo | Production contract |
|---|---|---|
| Database | SQLite | PostgreSQL 18 |
| Rate limiting | Process-local | PostgreSQL-backed |
| Background work | Embedded in web process | Dedicated worker |
| URL | `http://localhost:3000` | Canonical HTTPS origin |
| Secrets | Ignored `.env.local` | Secret manager or mounted secret files |
| Calendar | Local or Google | Google |
| Email | Local inbox or SMTP | TLS SMTP |
| Payments | Stub or Stripe test | Stripe test only, or `FREE_ONLY=true` with no Stripe |

Do not expose the local demo configuration to the public internet.

## Production components

The repository provides:

- `Dockerfile` target `runtime` for both web and worker
- `Dockerfile` target `migration` for database migrations
- `compose.production.yml` as the required service and secret topology
- `infrastructure/postgresql/` for PostgreSQL TLS and host-based access controls
- `prisma/postgresql/` for the generated schema, baseline migration, row-level security, and runtime guards
- `scripts/provision-postgres-logins.mjs` for separate migration, app, worker, and monitor credentials
- `scripts/backup-postgres.ps1` and `scripts/restore-postgres.ps1` for encrypted backup and restore workflows

Historical internal identifiers beginning with `tempocove` remain in database roles and generated artifacts for migration compatibility. They are not customer-facing branding.

## Production environment contract (names only)

Inject these names through the orchestrator; this document intentionally contains
no secret values. The web service uses `DATABASE_URL_FILE` and
`DATABASE_ROLE=app`; the worker uses `WORKER_DATABASE_URL_FILE` and
`DATABASE_ROLE=worker`; the migration service uses `DATABASE_URL_FILE` with the
migration role. All three use `DATABASE_PROVIDER=postgresql`.

Required non-secret runtime settings are `NODE_ENV=production`, `BUILD_ID`,
`NEXT_PUBLIC_APP_URL`, `FREE_ONLY`, `NEXT_PUBLIC_FREE_ONLY`,
`CALENDAR_PROVIDER=google`, `GOOGLE_CLIENT_ID`, `EMAIL_PROVIDER=smtp`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS_MODE`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`EMAIL_SENDER_DOMAIN`, and `OUTBOX_WORKER_MODE=dedicated`. The app service also
sets `RATE_LIMIT_PROVIDER=postgresql`, `TRUST_PROXY=true`, and
`BOOKING_CAPABILITY_KEY_ID`.

Mount secret files under `/run/secrets/` for the names referenced by
`AUTH_SECRET_FILE`, `BOOKING_CAPABILITY_SECRET_FILE`,
`BOOKING_CAPABILITY_KEYRING_FILE`, `TOKEN_ENCRYPTION_KEY_FILE`,
`EMAIL_TOKEN_SECRET_FILE`, `TENANT_CONTEXT_SECRET_FILE`,
`RATE_LIMIT_HASH_SECRET_FILE`, `PROXY_SHARED_SECRET_FILE`,
`OPERATOR_HEALTH_SECRET_FILE`, `SMTP_PASSWORD_FILE`, and
`GOOGLE_CLIENT_SECRET_FILE`. When lifecycle delivery is enabled, also mount
`BLOCKWISE_WEBHOOK_SECRET_FILE` and set `BLOCKWISE_WEBHOOK_URL` to HTTPS.
Free-only mode must not mount payment-provider secrets; `PAYMENTS_PROVIDER=stub`
is sufficient.

## Deployment sequence

### 1. Prepare a domain and HTTPS ingress

Choose the final origin before configuring providers. The hosted Blockwise
service uses:

```text
https://book.blockwise.sale
```

Set `NEXT_PUBLIC_APP_URL` to that exact HTTPS origin. It is the base for
booking links, manage links, email recovery links, and provider callbacks; do
not include a path, query, or fragment. Other deployments should substitute a
single canonical origin consistently in provider consoles and runtime secrets.

Your reverse proxy must terminate HTTPS, strip any incoming proxy-authentication header from the client, inject the trusted `PROXY_SHARED_SECRET`, and forward requests to the web container.

### 2. Prepare PostgreSQL 18

Use PostgreSQL 18 with verified TLS. The production URLs must include:

```text
sslmode=verify-full
sslrootcert=/absolute/or/container/path/to/ca.crt
connect_timeout=3
pool_timeout=20
connection_limit=20
statement_timeout=2000
```

The exact app, worker, migration, and monitor URLs use different database logins. Bootstrap owner credentials must never be mounted into the web or worker container.

Generate and validate the PostgreSQL artifacts:

```bash
npm ci
npm run db:generate:postgres
npm run db:baseline:postgres
```

Provision the runtime logins from an operator-controlled environment:

```bash
npm run db:provision:postgres-logins
```

That command requires the bootstrap database URL plus independent values for:

- `TEMPOCOVE_MIGRATION_DB_PASSWORD`
- `TEMPOCOVE_APP_DB_PASSWORD`
- `TEMPOCOVE_WORKER_DB_PASSWORD`
- `TEMPOCOVE_MONITOR_DB_PASSWORD`
- `TENANT_CONTEXT_SECRET`

### 3. Create independent application secrets

Required application secrets include:

- `AUTH_SECRET`
- `BOOKING_CAPABILITY_SECRET`
- `BOOKING_CAPABILITY_KEYRING`
- `TOKEN_ENCRYPTION_KEY`, exactly 64 hexadecimal characters
- `EMAIL_TOKEN_SECRET`
- `TENANT_CONTEXT_SECRET`
- `RATE_LIMIT_HASH_SECRET`
- `PROXY_SHARED_SECRET`
- `OPERATOR_HEALTH_SECRET`
- Provider secrets for Google and SMTP; Stripe test secrets are required unless
  `FREE_ONLY=true`. If Blockwise lifecycle delivery is enabled, also mount the
  generated `BLOCKWISE_WEBHOOK_SECRET` and set its HTTPS destination URL.

Every secret must be independent. Store them in the platform's secret manager or mount them as files. Never bake them into an image.

### 4. Build immutable images

Use the 40-character Git commit SHA as `BUILD_ID`:

```bash
BUILD_ID=$(git rev-parse HEAD)
docker build --build-arg BUILD_ID="$BUILD_ID" --target runtime -t snagtime:"$BUILD_ID" .
docker build --target migration -t snagtime-migration:"$BUILD_ID" .
```

The runtime refuses to start when its configured `BUILD_ID` does not match the compiled build.

### 5. Run migration, web, and worker

Run the production PostgreSQL migration image with the migration database URL
first. With the external Docker secrets created, the free-only deployment uses
this one-shot migration service (the `migration` profile prevents it from
starting with the long-running services):

```bash
docker compose --profile migration -f compose.free-only.yml run --rm migration
```

For a manually managed runtime image, use the repository's PostgreSQL migration
script with the migration role's PostgreSQL URL. Do not run a SQLite migration
against a production database. Then run two copies of the runtime image:

- Web command: `node apps/web/server.js`
- Worker command: `node dist/worker.mjs`

Use `compose.production.yml` to see the required environment split and secret mounts for each service. The file deliberately declares secrets as external, so your orchestration layer must create them before startup.

For a deployment that must never provision or mount payment-provider credentials, use the self-contained `compose.free-only.yml` contract. It sets `FREE_ONLY=true`, uses the real Google Calendar provider (Google client ID plus the mounted `google_client_secret` are still required), and stub payments. It intentionally has no payment-provider secret declarations. Validate it with `docker compose -f compose.free-only.yml config`.

### 6. Configure providers

Follow [Integration setup](INTEGRATION-SETUP.md). The hosted callbacks use the final HTTPS origin.

### 7. Verify before sharing a booking link

At minimum:

1. Confirm `/api/health/live` responds.
2. Confirm `/api/health/ready` reports ready.
3. Register and verify a fresh account.
4. Connect Google Calendar and verify free/busy blocking.
5. Create, reschedule, and cancel a free booking.
6. Confirm organizer and invitee SMTP delivery from unrelated mailboxes.
7. Complete and refund a Stripe test booking, or verify that free-only mode
   rejects every paid event and does not require Stripe.
8. Restart web and worker containers and verify data remains intact.
9. Run an encrypted backup and restore it into an isolated empty database.

## Backup and restore commands

Run backups from an operator workstation with the production database URL and
encryption key supplied through the protected environment. Do not put either
value in shell history or a committed file:

```powershell
pwsh -NoProfile -File scripts/backup-postgres.ps1 `
  -PgDumpPath "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -DatabaseUrlSecret "C:\operator-secrets\snagtime-database-url" `
  -EncryptionKeySecret "C:\operator-secrets\snagtime-backup-key.b64" `
  -EncryptedTempDirectory "D:\snagtime-backup-tmp" `
  -OutputDirectory "D:\snagtime-backups"
```

For a restore drill, stop writers and restore into an isolated empty
PostgreSQL database, then run the verification SQL before accepting the
backup:

```powershell
pwsh -NoProfile -File scripts/restore-postgres.ps1 `
  -PgRestorePath "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" `
  -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
  -TargetDatabaseUrlSecret "C:\operator-secrets\snagtime-isolated-database-url" `
  -EncryptionKeySecret "C:\operator-secrets\snagtime-backup-key.b64" `
  -EncryptedTempDirectory "D:\snagtime-restore-tmp" `
  -BackupPath "D:\snagtime-backups\tempocove-<timestamp>.dump.aesgcm" `
  -ExpectedSha256 "<recorded SHA-256>" `
  -ConfirmIsolatedEmptyTarget
```

The restore script queries the target before writing and rejects any existing
user tables. `-AllowNonEmptyTarget` is an exceptional, verified override and
must be accompanied by `-NonEmptyTargetOverrideReason "<ticket and approval>"`;
use it only when the target has been reviewed and writers are stopped.

The scripts fail closed when TLS or encryption inputs are missing. Keep backup
artifacts outside the repository and remove temporary restore databases after
the acceptance drill.

## Platform notes

### Vercel

Not supported by this repository's current production contract. The web frontend is Next.js, but the system also needs PostgreSQL runtime roles and a dedicated continuously running worker.

### ChatGPT Sites

Not compatible. This is not a static site and needs server-side code, persistent storage, OAuth callbacks, and webhooks.

### Railway, Render, Fly.io, and similar platforms

Potentially compatible if configured as separate web and worker services with PostgreSQL, stable HTTPS, mounted secrets, and the required database TLS posture. No one-click template is included or verified in this release.

### Linux VPS with Docker

The closest match to the included architecture because you control the reverse proxy, certificates, PostgreSQL container, secret mounts, worker, and backups. It also carries the most operational responsibility.

## Operational ownership

The MIT-licensed software is free. A public service is not maintenance-free. The deployer owns:

- Hosting and domain costs
- Database capacity and backups
- Security updates and dependency alerts
- Google OAuth consent and verification requirements
- SMTP reputation, SPF, DKIM, DMARC, and deliverability
- Stripe account configuration and any future live-mode implementation
- Privacy policy, terms, data retention, and regulatory obligations
- Monitoring, incident response, and disaster recovery
