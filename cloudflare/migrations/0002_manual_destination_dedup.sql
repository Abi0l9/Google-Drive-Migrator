PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migration_manual_options (
  migration_id TEXT PRIMARY KEY,
  merge_into_destination INTEGER NOT NULL DEFAULT 0 CHECK (merge_into_destination IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_existing_items (
  id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL,
  destination_file_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE,
  UNIQUE (migration_id, destination_file_id)
);

CREATE INDEX IF NOT EXISTS migration_existing_items_lookup_idx
  ON migration_existing_items(migration_id, parent_id, name);
