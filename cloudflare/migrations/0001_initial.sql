PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  image TEXT,
  google_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL DEFAULT '',
  access_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_folder_id TEXT NOT NULL,
  source_folder_url TEXT NOT NULL,
  source_folder_name TEXT NOT NULL,
  destination_folder_id TEXT NOT NULL,
  destination_folder_name TEXT NOT NULL,
  destination_root_folder_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scanning','running','paused','completed','failed','cancelled')),
  scan_completed INTEGER NOT NULL DEFAULT 0 CHECK (scan_completed IN (0,1)),
  pending_scan_jobs INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  completed_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  copied_bytes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS migrations_user_created_idx ON migrations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS migrations_status_idx ON migrations(status);
CREATE UNIQUE INDEX IF NOT EXISTS migrations_active_duplicate_idx
  ON migrations(user_id, source_folder_id, destination_folder_id)
  WHERE status IN ('pending','scanning','running','paused');

CREATE TABLE IF NOT EXISTS migration_items (
  id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_mime_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  destination_file_id TEXT,
  destination_folder_id TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('file','folder')),
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  encrypted_upload_session_url TEXT,
  transfer_job_id TEXT,
  transfer_lease_until TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','copying','completed','failed','skipped')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE,
  UNIQUE (migration_id, source_file_id)
);

CREATE INDEX IF NOT EXISTS migration_items_migration_status_idx ON migration_items(migration_id, status);
CREATE INDEX IF NOT EXISTS migration_items_transfer_lease_idx ON migration_items(status, transfer_lease_until);
CREATE INDEX IF NOT EXISTS migration_items_migration_type_idx ON migration_items(migration_id, item_type);

CREATE TABLE IF NOT EXISTS daily_usage (
  usage_date TEXT PRIMARY KEY,
  queue_messages INTEGER NOT NULL DEFAULT 0,
  migrations_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runtime_activity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
