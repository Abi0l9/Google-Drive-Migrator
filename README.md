# Google Drive Folder Migrator

A Next.js application scaffold for copying the contents of a publicly accessible Google Drive folder into a user's Google Drive account.

## MVP capabilities

- Public Google Drive folder URL analysis and recursive statistics.
- Auth.js Google OAuth configuration with Drive scopes.
- MongoDB/Mongoose models for users, migrations, and migration items.
- BullMQ queues for scan, transfer, retry, and report workflows.
- Route handlers for folder analysis, migration creation, and migration progress snapshots.
- Landing page, user dashboard placeholder, and admin dashboard placeholder.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in Google, MongoDB, and Redis values.
2. Install dependencies with `npm install`.
3. Run the development server with `npm run dev`.

## Docker local stack

1. Copy `.env.example` to `.env.local` and fill in Google OAuth/API values.
2. Start the app, worker, MongoDB, and Redis with `docker compose up --build`.
3. Open `http://localhost:3000` for the web app while the `worker` service processes queued scans and transfers.

## Development tracking

See [DEVELOPMENT_CHECKLIST.md](./DEVELOPMENT_CHECKLIST.md) for the full MVP and roadmap checklist.

## Notes

Google Workspace files are exported during streaming transfers: Docs to DOCX, Sheets to XLSX, and Slides to PPTX. Standard Drive files are streamed from source to destination without being written to disk.
