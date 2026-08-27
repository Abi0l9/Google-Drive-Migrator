# Google Drive Folder Migrator

Google Drive Folder Migrator (GDM) copies a publicly accessible Google Drive folder into an authenticated user's Google Drive without modifying the source folder.

Public app: `https://gdm.innovvohq.online`

## Current capabilities

- Analyze public Google Drive folder URLs recursively before starting a migration.
- Sign in with Google through Auth.js using the narrow `drive.file` scope.
- Choose an existing destination folder with Google Picker or migrate into My Drive.
- Recreate nested folder structures in My Drive or the selected Drive folder.
- Open the migrated destination folder directly from the migration page or dashboard.
- Stream standard Drive files source-to-destination without writing them to local disk.
- Export Google Docs to DOCX, Sheets to XLSX, and Slides to PPTX.
- Use resumable 8 MB chunk uploads for standard files larger than 5 MB.
- Persist encrypted resumable-session URLs and confirmed byte offsets so large uploads can continue after interruptions.
- Refresh expired Google access tokens from encrypted refresh tokens.
- Run scans, transfers, retry/resume sweeps, and report work through BullMQ + Redis.
- Detect destination items created by the migration and avoid duplicate files/folders on retries.
- Pause, resume, cancel, and retry failed files from the migration progress page.
- Distinguish retryable Google rate-limit/network/server failures from permanent permission/not-found failures.
- Show per-file upload progress and detailed failed-item reasons.
- Protect the admin dashboard with an `ADMIN_EMAILS` allowlist and show live database + queue health metrics.
- Run CI for production dependency audit, tests, typecheck, lint, and Next.js production build.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Configure MongoDB and Redis.
3. Configure the Google Drive API, Google Picker API, OAuth web client, and API keys described below.
4. Install dependencies with `npm install`.
5. Run the web app with `npm run dev`.
6. Run the BullMQ worker separately with `npm run worker`, or use Docker Compose to run the complete local stack.

## Google Cloud setup

Use one Google Cloud project for the OAuth client, Drive API, and Picker App ID.

1. Enable **Google Drive API** and **Google Picker API** in the project.
2. Create an OAuth 2.0 Web application client and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Add the Auth.js callback URL to the OAuth client's authorized redirect URIs:
   - local: `http://localhost:3000/api/auth/callback/google`
   - production: `https://gdm.innovvohq.online/api/auth/callback/google`
4. Create `GOOGLE_API_KEY` for server-side public-folder Drive reads. Restrict it to the Drive API where possible.
5. Create a separate browser key for `GOOGLE_PICKER_API_KEY`. Restrict it to the Google Picker API and your allowed HTTP referrers/domains, including `https://gdm.innovvohq.online` in production.
6. Set `GOOGLE_CLOUD_PROJECT_NUMBER` to the numeric Cloud project number. Picker requires this App ID when using the `drive.file` scope.
7. Configure the OAuth consent screen and add only the Google scopes the app uses: `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.file`.

GDM intentionally uses Google Picker for existing destination folders. That explicit selection keeps the destination flow aligned with the narrow `drive.file` permission instead of requesting broad Drive access.

The Picker bootstrap endpoint returns a fresh user access token only when an authenticated user opens Picker. The response is `no-store`; OAuth tokens are not placed on the normal Auth.js session object.

## Environment variables

See `.env.example`. Important values include:

- `MONGODB_URI`
- `REDIS_URL`
- `GOOGLE_API_KEY`
- `GOOGLE_PICKER_API_KEY`
- `GOOGLE_CLOUD_PROJECT_NUMBER`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `TOKEN_ENCRYPTION_KEY`
- `ADMIN_EMAILS` as a comma-separated allowlist

For production, set `NEXTAUTH_URL=https://gdm.innovvohq.online`.

Use a stable, strong `TOKEN_ENCRYPTION_KEY` in every environment that runs the web app or worker. Changing it makes previously encrypted Google tokens and resumable-upload session URLs unreadable.

## Docker local stack

1. Copy `.env.example` to `.env.local` and fill the required values.
2. Start the app, worker, MongoDB, and Redis with `docker compose up --build`.
3. Open `http://localhost:3000` for the web app while the worker service processes queued work.

## Transfer behavior

Google Workspace files are exported during transfers:

- Docs → DOCX
- Sheets → XLSX
- Slides → PPTX

Standard files at or below 5 MB use direct streaming upload. Larger standard files use resumable Drive uploads in 8 MB chunks. GDM stores the resumable session URL encrypted in MongoDB and records confirmed uploaded bytes so pause/retry/restart flows can continue rather than blindly restarting from byte zero.

## Development tracking

See [DEVELOPMENT_CHECKLIST.md](./DEVELOPMENT_CHECKLIST.md) for the remaining hardening and roadmap work.
