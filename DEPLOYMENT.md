# Production Deployment

GDM has two long-running application processes plus two managed data services:

1. **Web** — Next.js standalone server. Handles auth, analysis, migration APIs, dashboards, reports, and progress UI.
2. **Worker** — BullMQ worker process. Handles folder scans, transfers, resumable uploads, retry/resume sweeps, and report refreshes.
3. **MongoDB** — persistent migration/user/item state.
4. **Redis** — BullMQ queues, delayed jobs, distributed API rate limits, and worker heartbeat state.

The web and worker must use the same MongoDB, Redis, Google OAuth credentials, and `TOKEN_ENCRYPTION_KEY`.

## Container targets

The repository Dockerfile provides these stages:

- `dev` — local development image used by Docker Compose.
- `web` — production Next.js standalone web image.
- `worker` — production BullMQ worker image.
- `production` — alias of `web` and the default result of `docker build .`.

Build the web image:

```bash
docker build -t gdm-web .
```

Build the worker image:

```bash
docker build --target worker -t gdm-worker .
```

## Required environment

Set these values on both web and worker unless noted otherwise:

```text
MONGODB_URI=
REDIS_URL=
GOOGLE_API_KEY=
GOOGLE_PICKER_API_KEY=
GOOGLE_CLOUD_PROJECT_NUMBER=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://your-domain.example
TOKEN_ENCRYPTION_KEY=
ADMIN_EMAILS=admin@example.com
MAX_ACTIVE_MIGRATIONS_PER_USER=3
```

`GOOGLE_PICKER_API_KEY`, `NEXTAUTH_URL`, `ADMIN_EMAILS`, and `MAX_ACTIVE_MIGRATIONS_PER_USER` are primarily web concerns, but keeping one shared environment definition is acceptable.

`MAX_ACTIVE_MIGRATIONS_PER_USER` defaults to `3` when omitted or invalid. Pending, scanning, running, and paused migrations count as active. A repeated request for the same source and destination reuses its existing active migration before the active-migration cap is evaluated.

### Encryption-key rule

`TOKEN_ENCRYPTION_KEY` must be stable and identical across every web and worker instance. Rotating it without a migration strategy makes stored Google tokens and resumable-upload session URLs unreadable.

## Google OAuth production callback

Add this redirect URI to the Google OAuth Web client:

```text
https://YOUR_DOMAIN/api/auth/callback/google
```

The production domain must also be allowed by the browser restriction on `GOOGLE_PICKER_API_KEY`.

## Health checks

The web process exposes:

```text
GET /api/health
```

MongoDB and Redis are readiness dependencies. If either is unavailable, the route returns HTTP 503.

The worker writes a Redis heartbeat every 10 seconds with a 30-second TTL. A missing worker heartbeat makes the JSON status `degraded` while the web route remains HTTP 200 if MongoDB and Redis are healthy. This avoids restarting a healthy web container merely because the separately deployed worker is down.

The response includes `database`, `queue`, `worker`, and `workerHeartbeatAt`. The protected `/admin` page also displays worker heartbeat state and BullMQ queue counts.

The production web Docker stage includes a container `HEALTHCHECK` against `/api/health`.

## Scaling

### Web

Multiple web instances can share the same MongoDB and Redis services. Auth.js secrets and token-encryption keys must be identical across instances. API request throttling uses Redis-backed counters so limits are shared across replicas, with a process-local fallback during Redis failure.

### Worker

Multiple worker containers can be started against the same Redis queues. BullMQ coordinates job delivery, while migration-item transfer leases protect against overlapping resume/retry jobs claiming the same file.

Start with conservative worker counts because Google Drive quotas apply to the project/user. Increase concurrency only after observing rate limits and transfer behavior.

## Deployment order

1. Provision MongoDB and Redis with persistent/managed storage.
2. Configure Google Drive API, Google Picker API, OAuth client, and API keys.
3. Deploy the worker image with its environment variables.
4. Deploy the web image and expose port 3000 through HTTPS.
5. Configure the final OAuth callback and Picker referrer restrictions for the production domain.
6. Verify `/api/health` returns HTTP 200 and reports a fresh worker heartbeat.
7. Sign in, choose a destination with Picker, and run a small migration before testing large/resumable files.
8. Add an operator email to `ADMIN_EMAILS` and verify `/admin` queue and worker health.
9. Test CSV/JSON report download after a completed migration.

## Rollback considerations

Application code can generally be rolled back independently because migration records are additive. Avoid rolling back across schema changes that remove fields still being written by newer workers.

In particular, current migrations can contain:

- `scanCompleted`
- `uploadedBytes`
- `encryptedUploadSessionUrl`
- `transferJobId`
- `transferLeaseUntil`

Older code that does not understand these fields may lose pause/resume or crash-recovery behavior even though MongoDB retains the data.

## Current deployment caveat

The repository intentionally uses exact dependency pins and CI performs a production `npm audit`, but a freshly regenerated `package-lock.json` has not yet been restored to the branch. Until that is resolved, image/CI installs use `npm install` rather than deterministic `npm ci`.
