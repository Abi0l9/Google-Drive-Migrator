export interface SelectedDestinationItem {
  id: string;
  parentId: string;
  name: string;
  mimeType: string;
  size?: number | null;
}

export interface ManualDuplicateLookup {
  name: string;
  mimeType?: string;
  size?: number;
}

export function buildManualDuplicateLookup(input: {
  name: string;
  size: number;
  workspaceMimeType?: string;
}): ManualDuplicateLookup {
  if (input.workspaceMimeType) {
    return { name: input.name, mimeType: input.workspaceMimeType };
  }
  return { name: input.name, size: Math.max(0, Math.floor(input.size)) };
}

export async function saveManualDedupSelection(
  db: D1Database,
  migrationId: string,
  mergeIntoDestination: boolean,
  items: SelectedDestinationItem[],
) {
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO migration_manual_options (migration_id, merge_into_destination, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(migration_id) DO UPDATE SET
        merge_into_destination = excluded.merge_into_destination,
        updated_at = CURRENT_TIMESTAMP
    `).bind(migrationId, mergeIntoDestination ? 1 : 0),
    db.prepare(`DELETE FROM migration_existing_items WHERE migration_id = ?`).bind(migrationId),
  ];

  for (const item of items) {
    statements.push(
      db.prepare(`
        INSERT INTO migration_existing_items (
          id, migration_id, destination_file_id, parent_id, name, mime_type, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(migration_id, destination_file_id) DO UPDATE SET
          parent_id = excluded.parent_id,
          name = excluded.name,
          mime_type = excluded.mime_type,
          size = excluded.size
      `).bind(
        crypto.randomUUID(),
        migrationId,
        item.id,
        item.parentId,
        item.name,
        item.mimeType,
        item.size == null ? null : Math.max(0, Math.floor(item.size)),
      ),
    );
  }

  await db.batch(statements);
}

export async function getManualDedupOptions(db: D1Database, migrationId: string) {
  const row = await db.prepare(`
    SELECT merge_into_destination AS mergeIntoDestination
    FROM migration_manual_options
    WHERE migration_id = ?
    LIMIT 1
  `).bind(migrationId).first<{ mergeIntoDestination: number }>();

  return { mergeIntoDestination: Boolean(row?.mergeIntoDestination) };
}

export async function findSelectedDestinationItem(
  db: D1Database,
  migrationId: string,
  parentId: string,
  lookup: ManualDuplicateLookup,
) {
  let sql = `
    SELECT
      destination_file_id AS destinationFileId,
      parent_id AS parentId,
      name,
      mime_type AS mimeType,
      size
    FROM migration_existing_items
    WHERE migration_id = ? AND parent_id = ? AND name = ?
  `;
  const bindings: Array<string | number> = [migrationId, parentId, lookup.name];

  if (lookup.mimeType) {
    sql += ` AND mime_type = ?`;
    bindings.push(lookup.mimeType);
  }
  if (lookup.size !== undefined) {
    sql += ` AND size = ?`;
    bindings.push(lookup.size);
  }
  sql += ` ORDER BY created_at ASC LIMIT 1`;

  return db.prepare(sql).bind(...bindings).first<{
    destinationFileId: string;
    parentId: string;
    name: string;
    mimeType: string;
    size?: number | null;
  }>();
}
