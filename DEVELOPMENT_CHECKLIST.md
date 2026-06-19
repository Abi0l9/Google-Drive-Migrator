# Google Drive Folder Migrator Development Checklist

Use this checklist to track MVP readiness and future product work. Status legend:

- [x] Implemented in current scaffold
- [ ] Not implemented yet
- [~] Partially implemented; needs hardening, tests, or production integration

## 1. Project foundation

- [x] Next.js App Router project structure
- [x] React + TypeScript configuration
- [x] Tailwind CSS configuration and global styles
- [~] ShadCN-style reusable UI primitives
- [x] Environment variable template
- [x] README with local setup notes
- [ ] Production deployment guide
- [x] Docker Compose for local MongoDB + Redis + app + worker
- [ ] CI workflow for install, lint, typecheck, tests, and build

## 2. Homepage and folder analyzer UI

- [x] Public Google Drive folder URL input
- [x] Analyze Folder button
- [x] Loading state during analysis
- [x] Error display for invalid or inaccessible folders
- [x] Analysis summary display for folder name, files, folders, and size
- [ ] Persist analyzed folder state across navigation
- [ ] Add URL examples and helper text
- [ ] Add accessible form validation messages
- [ ] Add responsive visual polish and empty states

## 3. Public folder validation and scanning

- [x] Extract folder ID from `/folders/:id` URLs
- [x] Extract folder ID from `?id=` URLs
- [x] Validate URL shape before API processing
- [x] Validate that the source is a Google Drive folder
- [x] Return `Invalid Google Drive Folder URL` for invalid source URLs
- [x] Return `Folder is not publicly accessible` for inaccessible source folders
- [x] Recursively scan nested folders
- [x] Count source files
- [x] Count source folders
- [x] Calculate total standard-file byte size
- [ ] Add cycle/duplicate safeguards for Drive shortcuts or unusual parent graphs
- [ ] Add scan cancellation
- [ ] Add paginated scan progress for very large folders
- [ ] Add scan result caching with expiration

## 4. Authentication and authorization

- [x] Auth.js Google provider setup
- [x] Required OAuth scopes configured: `openid`, `email`, `profile`, `drive.file`, `drive.metadata.readonly`
- [x] JWT callback captures Google access and refresh tokens
- [x] Session callback exposes access token for server use
- [ ] Persist encrypted OAuth tokens in MongoDB
- [ ] Refresh expired Google access tokens automatically
- [ ] Restrict migration APIs to the authenticated owner
- [ ] Add sign-in/sign-out UI controls
- [ ] Add auth-required redirects for dashboard and migration flows
- [ ] Add CSRF verification for mutating custom APIs beyond Auth.js defaults

## 5. Destination selection flow

- [ ] Root Drive destination option
- [ ] Existing folder picker
- [ ] Create new destination folder option
- [ ] Validate destination folder write access
- [ ] Preview destination path before migration starts
- [ ] Remember recent destination folders per user

## 6. Migration persistence

- [x] User model
- [x] Migration model with status, source, destination, counters, byte totals, and timestamps
- [x] Migration item model for files and folders
- [x] Store source file/folder path per migration item
- [x] Store destination IDs after creation/upload
- [x] Store retry counts and failure reasons
- [ ] Add model-level TypeScript interfaces
- [ ] Add compound indexes for common queries
- [ ] Add migration ownership checks on all reads/writes
- [ ] Add retention/cleanup policy for completed migration records

## 7. Queue system

- [x] BullMQ Redis connection
- [x] Scan queue
- [x] Transfer queue
- [x] Retry queue placeholder
- [x] Report queue
- [x] Shared default attempts and exponential backoff
- [x] Worker entrypoint script
- [x] Scan worker registration
- [x] Transfer worker registration
- [x] Report worker registration
- [ ] Dedicated retry worker implementation
- [ ] Dead-letter queue or failed-job dashboard
- [ ] Worker graceful shutdown handlers
- [ ] Worker concurrency tuning per queue
- [ ] Queue metrics and observability

## 8. Folder recreation engine

- [x] Create destination root folder
- [x] Create destination subfolders recursively
- [x] Store source-to-destination folder mappings in migration items
- [x] Preserve nested source paths
- [ ] Add collision strategy for duplicate destination names
- [ ] Preserve folder metadata where supported
- [ ] Handle Google Drive shortcuts explicitly
- [ ] Add idempotency so resumed scans do not duplicate existing folders

## 9. File transfer engine

- [x] Stream standard Drive files from source to destination without saving to disk
- [x] Export Google Docs as DOCX
- [x] Export Google Sheets as XLSX
- [x] Export Google Slides as PPTX
- [x] Mark files as copying, completed, or failed
- [x] Record destination file IDs
- [x] Increment completed/failed counters
- [x] Increment copied byte counters
- [ ] Accurate per-file streaming byte progress callbacks
- [ ] Transfer speed calculation
- [ ] Estimated time remaining calculation
- [ ] MIME type and extension normalization tests
- [ ] Large-file resumable uploads
- [ ] Backpressure tuning for stream stability
- [ ] Idempotent retry that skips already-uploaded files

## 10. Progress tracking and reporting

- [x] Migration progress API route
- [x] Total files response
- [x] Completed files response
- [x] Failed files response
- [x] Current file response based on copying item
- [x] Percentage calculation
- [x] Copied and total byte response
- [~] Report worker finalizes completed/failed status
- [ ] Live progress polling UI
- [ ] WebSocket/SSE progress updates
- [ ] Transfer speed response
- [ ] ETA response
- [ ] Completion report page
- [ ] Downloadable migration report JSON/CSV

## 11. Error handling and resume behavior

- [x] Invalid URL error message
- [x] Folder not public error message
- [x] BullMQ automatic retry attempts configured
- [x] Upload failure reason stored on migration item
- [x] Continue migration accounting after item failures
- [ ] Resume failed transfers from UI
- [ ] Pause migration on network outage
- [ ] Automatic resume after temporary Google/Redis/Mongo failure
- [ ] Distinguish retryable vs permanent Google API failures
- [ ] User-facing error taxonomy and troubleshooting text

## 12. Security and abuse prevention

- [x] Basic security headers middleware
- [x] Analyzer API rate limiting
- [~] Secure cookies handled by Auth.js when configured for production HTTPS
- [ ] Enforce HTTPS in production deployments
- [ ] Encrypt tokens at rest
- [ ] Never log OAuth tokens or Drive file content
- [ ] Add API rate limits for migration creation and progress routes
- [ ] Add per-user migration quotas
- [ ] Add request size limits and validation for all APIs
- [ ] Add admin route authorization

## 13. Dashboard and admin UX

- [x] Dashboard placeholder page
- [x] Admin dashboard placeholder page
- [ ] Migration creation wizard
- [ ] Destination selection UI
- [ ] Active migration list
- [ ] Migration detail/progress page
- [ ] Failed item list with retry actions
- [ ] Admin metrics backed by database aggregation
- [ ] Admin filters for active, failed, and completed migrations
- [ ] Admin queue health view

## 14. Testing

- [x] Typecheck script configured
- [ ] Unit tests for folder URL parsing
- [ ] Unit tests for rate limiter
- [ ] Unit tests for Workspace export naming
- [ ] Integration tests for analyze API with mocked Google Drive API
- [ ] Integration tests for migration creation authorization
- [ ] Worker tests with mocked MongoDB, Redis, and Google Drive clients
- [ ] End-to-end test for analyze-to-migration happy path
- [ ] Load test plan for folders with thousands of files

## 15. Documentation

- [x] README overview and setup steps
- [x] `.env.example` for required configuration
- [x] Development checklist
- [ ] OAuth app setup guide with screenshots
- [ ] Google Drive API quota and permissions guide
- [~] Worker deployment guide
- [ ] Troubleshooting guide for common Google API errors
- [ ] Security model documentation
- [ ] Operational runbook for failed queues and retries

## 16. Future roadmap

- [ ] Authenticated source Drive support for Drive A → Drive B
- [ ] Multi-cloud destinations: Dropbox, OneDrive, Box
- [ ] Scheduled migrations
- [ ] ZIP download mode
- [ ] User-selectable Google Workspace export formats
- [ ] Paid subscriptions and usage limits
- [ ] Team collaboration features


## 17. Local operations

- [x] Dockerfile for app and worker containers
- [x] Docker Compose services for app, worker, MongoDB, and Redis
- [x] MongoDB healthcheck
- [x] Redis healthcheck
- [ ] Seed script for local demo data
- [ ] One-command smoke test for Docker stack
