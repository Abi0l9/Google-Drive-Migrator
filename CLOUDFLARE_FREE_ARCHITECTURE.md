# GDM Cloudflare Zero-Cost Runtime

GDM's Cloudflare deployment is intentionally designed for the **Workers Free plan only**. The product must degrade, pause, or reject new work before it creates a bill.

## Non-negotiable rule

**Zero-cost mode fails closed.**

GDM must not depend on Cloudflare Containers, Workers Paid, metered overages, or an external paid database/queue. If a Free-plan quota is exhausted, the application should surface a capacity message and resume after the relevant quota resets.

## Runtime layout

### `gdm-web`

OpenNext/Next.js Worker responsible for:

- UI and static assets
- Auth.js Google OAuth
- public-folder analysis
- Google Picker bootstrap
- migration CRUD/control APIs
- progress/report APIs
- D1 persistence
- publishing background jobs to Cloudflare Queues
- Cloudflare Rate Limiting bindings

Static assets are served before the Worker whenever possible so they do not consume Worker request quota.

### `gdm-jobs`

Small Worker with a Cloudflare Queue consumer responsible for:

- recursive source-folder scan jobs
- destination-folder creation
- Drive-to-Drive file transfer jobs
- resumable transfer continuation
- retry/resume dispatch
- terminal migration reconciliation

The consumer uses a maximum concurrency of 1 initially to protect Google Drive quotas and keep behavior predictable on the Free plan.

## Cloudflare services

| Existing runtime | Cloudflare Free replacement |
| --- | --- |
| MongoDB / Mongoose | D1 |
| Redis | D1 atomic state + Cloudflare Rate Limiting bindings |
| BullMQ | Cloudflare Queues |
| long-running Node worker | Queue consumer Worker |
| Docker web image | OpenNext Worker |
| Docker worker image | Queue consumer Worker |
| worker heartbeat | queue metrics + last consumer activity in D1 |

R2 is **not required** for file migration. User files should stream directly from Google Drive to Google Drive and must not be staged in Cloudflare storage.

## Free-tier guardrails

These are application guardrails, intentionally lower than Cloudflare's platform ceilings.

- `GDM_ZERO_COST_MODE=true`
- `GDM_DAILY_QUEUE_MESSAGE_BUDGET=2200`
- `MAX_ACTIVE_MIGRATIONS_PER_USER=3`
- one queue consumer concurrency by default
- bounded public-folder analysis within a single HTTP invocation
- background scan/transfer jobs continue work in small idempotent units
- large binary files use resumable Google Drive uploads and streaming ranges rather than buffering

The daily queue-message budget counts every message GDM publishes, including scan, transfer continuation, resume, and retry dispatch jobs. Reserving capacity happens in D1 before publishing.

## Important Free-plan platform ceilings

The architecture is based on the Cloudflare limits current on 2026-08-26:

- Workers Free: 100,000 Worker requests/day and 10 ms CPU/invocation.
- Worker script size: 3 MB on Free.
- External subrequests: 50/invocation on Free.
- D1: 5 million rows read/day, 100,000 rows written/day, 5 GB account storage, 500 MB per Free database.
- Queues Free: 10,000 operations/day and 24-hour retention.
- Queue consumer wall-clock duration: up to 15 minutes.
- Static asset requests can bypass Worker invocation and are free/unlimited.

Platform limits can change; verify Cloudflare documentation before changing the internal budgets.

## Failure behavior

When GDM cannot reserve another queue job within its own daily budget:

1. do not publish the message;
2. leave the migration/item state resumable in D1;
3. set a clear capacity reason;
4. tell the user that free daily capacity has been reached;
5. allow resume after the next UTC quota reset.

Cloudflare Free-plan limits themselves fail with errors rather than creating paid overages, but GDM should normally stop before reaching them.

## Deployment resources

The intended Cloudflare account resources are:

- Worker: `gdm-web`
- Worker: `gdm-jobs`
- D1 database: `gdm`
- Queue: `gdm-jobs`
- Dead-letter queue: `gdm-jobs-dlq`

Secrets are set with Wrangler/Cloudflare secrets and are never committed:

- `GOOGLE_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `TOKEN_ENCRYPTION_KEY`

Non-secret values include:

- `GOOGLE_PICKER_API_KEY`
- `GOOGLE_CLOUD_PROJECT_NUMBER`
- `ADMIN_EMAILS`
- `MAX_ACTIVE_MIGRATIONS_PER_USER`
- `GDM_DAILY_QUEUE_MESSAGE_BUDGET`
- `GDM_ZERO_COST_MODE`
