# Google Drive Folder Migrator Development Checklist

Status legend:

- [x] Implemented
- [~] Implemented but still needs production hardening or deeper tests
- [ ] Not implemented yet

## 1. Project foundation

- [x] Next.js App Router + React + TypeScript
- [x] Tailwind CSS and reusable UI primitives
- [x] Environment variable template
- [x] Docker Compose local stack with MongoDB and Redis healthchecks
- [x] Multi-stage Dockerfile with `dev`, production web, and production worker targets
- [x] Next.js standalone production output
- [x] GitHub Actions CI for production dependency audit, tests, typecheck, lint, and build
- [x] Production deployment guide
- [ ] Restore a freshly generated audited `package-lock.json` and switch CI/images back to deterministic `npm ci`

## 2. Public folder analyzer

- [x] Public Google Drive folder URL input
- [x] `/folders/:id` and `?id=` folder ID parsing
- [x] Restrict source URLs to `drive.google.com`
- [x] Validate that the source is a folder and publicly accessible
- [x] Recursive nested-folder scan
- [x] File/folder counts and total standard-file bytes
- [x] Loading and error states
- [~] Cooperative scan cancellation and pause checks
- [ ] Persist analyzed state across navigation/reloads
- [ ] Large-scan progress during analysis
- [ ] Scan-result caching with expiry
- [ ] Explicit shortcut/cycle handling

## 3. Authentication and Google authorization

- [x] Auth.js Google provider
- [x] Narrow OAuth scope: `openid email profile drive.file`
- [x] Capture Google access and refresh tokens
- [x] Encrypt tokens before MongoDB persistence
- [x] Refresh expired Google access tokens automatically
- [x] Keep provider access tokens out of the normal browser session
- [x] Auth ownership checks on migration reads/actions
- [x] Sign-in/sign-out UI
- [~] Reauthentication UX when a refresh token is revoked or missing
- [ ] Dedicated token-rotation/credential invalidation operations guide

## 4. Destination selection

- [x] My Drive root option
- [x] Existing folder URL/ID fallback
- [x] Server-side destination folder validation
- [x] Validate ability to add children
- [x] Google Picker folder selection
- [x] Picker support for Shared Drives
- [x] Separate browser API key and Cloud project App ID configuration
- [x] Picker bootstrap token delivered only on demand with `no-store`
- [ ] Create-new-destination-folder control before migration
- [ ] Remember recent destinations per user

## 5. Migration persistence and idempotency

- [x] User model
- [x] Migration model with source, destination, counters, bytes, status, timestamps
- [x] Migration item model with path, status, retries, upload progress, destination IDs
- [x] Unique migration/source-file item constraint
- [x] Preserve destination root separately from selected destination parent
- [x] Tag Drive-created files/folders with migration/source app properties
- [x] Discover previously created destination items before creating duplicates
- [x] Reuse scan records on rescan/retry
- [x] Server-side deduplication of active source+destination migration creation
- [x] Paused migrations count as active duplicates
- [~] Transfer worker leases protect against overlapping resume/retry jobs and stale claims
- [ ] Retention/cleanup policy for completed migration and item records

## 6. Queue and worker system

- [x] BullMQ + Redis connection
- [x] Scan queue
- [x] Transfer queue
- [x] Retry/resume queue
- [x] Report queue
- [x] Exponential backoff and bounded attempts
- [x] Scan worker
- [x] Transfer worker
- [x] Retry/resume sweep worker
- [x] Report worker
- [x] Graceful worker/queue/Redis shutdown on SIGTERM/SIGINT
- [x] Atomic transfer-item claims
- [x] Transfer leases with stale-job recovery
- [~] Conservative transfer concurrency (currently 1 per worker process)
- [x] Protected admin queue counters
- [ ] Dedicated worker heartbeat/liveness record
- [ ] Queue alerting/metrics export
- [ ] Dead-letter management UI

## 7. Folder recreation engine

- [x] Create destination migration root
- [x] Recreate nested folder structure recursively
- [x] Preserve source paths
- [x] Store source-to-destination mappings
- [x] Retry-safe/idempotent folder creation through app-property markers
- [x] Shared Drive-compatible Drive flags
- [ ] Explicit duplicate-name/collision policy for pre-existing untagged destination content
- [ ] Preserve supported folder metadata
- [ ] Explicit Google Drive shortcut handling

## 8. File transfer engine

- [x] Direct stream copy for standard small files without local disk persistence
- [x] Google Docs → DOCX
- [x] Google Sheets → XLSX
- [x] Google Slides → PPTX
- [x] Destination file ID persistence
- [x] Per-item copying/completed/failed states
- [x] Completed/failed byte and file accounting
- [x] Large standard-file resumable uploads above 5 MB
- [x] 8 MB resumable chunks
- [x] Encrypted resumable session URL persistence
- [x] Confirmed uploaded-byte persistence
- [x] Resume from Google's accepted offset
- [x] Recover expired resumable sessions
- [x] Retry-safe destination lookup before re-upload
- [~] Cooperative pause/cancel between resumable chunks
- [ ] Transfer speed calculation
- [ ] ETA calculation
- [ ] Stream/backpressure soak tests for very large files
- [ ] User-selectable Workspace export formats

## 9. Progress, pause, resume, cancel, retry

- [x] Migration detail/progress page
- [x] Polling progress UI
- [x] Total/completed/failed files
- [x] Overall processed percentage
- [x] Total/copied bytes
- [x] Current file and per-file resumable byte progress
- [x] Detailed failed-file list with path, retry count, and error
- [x] Retry only failed items
- [x] Cancel pending/scanning/running/paused migrations
- [x] Pause pending/scanning/running migrations
- [x] Resume paused scans idempotently
- [x] Resume paused transfer migrations through delayed retry sweep
- [x] Preserve resumable upload state across pause/resume
- [~] Small direct-stream uploads may finish before a pause/cancel can take effect
- [ ] SSE/WebSocket progress instead of polling
- [ ] Completion summary/report export (JSON/CSV)

## 10. Google/API error handling

- [x] Invalid source URL errors
- [x] Public-folder accessibility errors
- [x] Destination accessibility/permission errors
- [x] Store transfer failure messages
- [x] Distinguish retryable vs permanent Google API errors
- [x] Retry rate limits, 429, transient network failures, and Google 5xx failures
- [x] Stop retrying ordinary permission/not-found/auth/invalid-request failures
- [x] Use BullMQ `UnrecoverableError` for permanent failures
- [x] Resumable-session 404/410 recovery
- [ ] Rich user-facing troubleshooting taxonomy/actions for every common Google error reason

## 11. Security and abuse prevention

- [x] Basic security headers
- [x] Analyzer rate limiting
- [x] Migration creation rate limiting
- [x] Picker-token bootstrap rate limiting
- [x] Active migration request deduplication
- [x] Encrypted Google credentials at rest
- [x] Encrypted resumable-session URLs at rest
- [x] No OAuth token in Auth.js browser session
- [x] Admin email allowlist
- [x] Admin route protection
- [x] Picker browser token response uses no-store caching
- [~] Auth.js secure cookie behavior relies on correctly configured production HTTPS/domain
- [ ] Explicit per-user concurrent migration quota
- [ ] Per-user data/usage quotas
- [ ] Distributed rate limiting for multi-instance deployments (current limiter is process-local)
- [ ] Content-Security-Policy tuned for Google Picker/Auth assets

## 12. User dashboard

- [x] Authenticated recent migration history
- [x] Links back to migration detail/progress
- [x] Completed/failed file summary cards
- [ ] Pagination beyond latest migrations
- [ ] Filters by status/date
- [ ] Search by source folder
- [ ] Destination shortcut/open-in-Drive action

## 13. Admin and operations

- [x] Protected `/admin` route using `ADMIN_EMAILS`
- [x] Total users
- [x] Total migrations
- [x] Active migrations including paused
- [x] Failed migrations
- [x] Total completed files
- [x] Total copied bytes
- [x] Scan/transfer/retry/report queue counts
- [x] Redis availability state in admin UI
- [x] Public dependency-aware `/api/health` endpoint
- [x] Docker web healthcheck
- [x] Mongo connection promise resets after failed startup connection
- [ ] Worker heartbeat/health endpoint or record
- [ ] Admin migration filters/details
- [ ] Admin failed-job retry/removal operations
- [ ] Operational alerting

## 14. Testing and validation

- [x] Drive URL parser tests
- [x] Google error-classification tests
- [x] Resumable threshold tests
- [x] Resumable Range-offset parser tests
- [x] CI production dependency audit
- [x] CI TypeScript check
- [x] CI ESLint
- [x] CI Next.js production build
- [ ] Rate-limiter unit tests
- [ ] Workspace export naming tests
- [ ] Migration API integration tests with mocked Google APIs
- [ ] Pause/resume/cancel API integration tests
- [ ] Worker tests with isolated MongoDB/Redis/Drive clients
- [ ] Docker image build smoke test in CI
- [ ] End-to-end analyze → Picker → migration → completion test
- [ ] Load/soak tests with thousands of files and multi-GB transfers

## 15. Deployment and documentation

- [x] Current README
- [x] `.env.example`
- [x] Production deployment guide
- [x] Google Picker/OAuth setup notes
- [x] Web and worker container targets
- [x] Health endpoint documentation
- [x] Encryption-key consistency warning
- [~] Queue/worker operations guidance
- [ ] Screenshotted Google Cloud setup guide
- [ ] Full troubleshooting guide
- [ ] Backup/restore and disaster-recovery runbook

## 16. Next hardening priorities

- [ ] Restore audited `package-lock.json` and deterministic installs
- [ ] Add distributed per-user quotas/rate limits
- [ ] Add worker heartbeat and alerting
- [ ] Add Worker/API integration tests
- [ ] Add shortcut/cycle handling
- [ ] Add downloadable completion report
- [ ] Add transfer speed/ETA
- [ ] Run large-folder and large-file soak tests

## 17. Future product roadmap

- [ ] Authenticated private source Drive / Drive A → Drive B
- [ ] Multi-cloud destinations: Dropbox, OneDrive, Box
- [ ] Scheduled migrations
- [ ] ZIP download mode
- [ ] User-selectable Workspace export formats
- [ ] Paid subscriptions and usage limits
- [ ] Team collaboration features
