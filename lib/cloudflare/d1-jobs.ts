import type { GdmMigration } from "@/lib/cloudflare/d1";

export function claimFolderScan(
  db: D1Database,
  migrationId: string,
  sourceFolderId: string,
  jobId: string,
  leaseUntil: string,
  now = new Date().toISOString(),
) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'copying',
        transfer_job_id = ?,
        transfer_lease_until = ?,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE migration_id = ?
      AND source_file_id = ?
      AND item_type = 'folder'
      AND (
        status = 'pending'
        OR (status = 'copying' AND transfer_job_id = ?)
        OR (status = 'copying' AND transfer_lease_until IS NOT NULL AND transfer_lease_until < ?)
      )
    RETURNING id, destination_folder_id AS destinationFolderId, status
  `).bind(jobId, leaseUntil, migrationId, sourceFolderId, jobId, now)
    .first<{ id: string; destinationFolderId: string; status: string }>();
}

export function completeFolderScan(db: D1Database, itemId: string) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'completed',
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND item_type = 'folder'
  `).bind(itemId).run();
}

export function continueFolderScan(db: D1Database, itemId: string) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'pending',
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND item_type = 'folder'
  `).bind(itemId).run();
}

export async function listPendingFolderItems(db: D1Database, migrationId: string, limit = 40, afterId = "") {
  const result = await db.prepare(`
    SELECT
      id,
      source_file_id AS sourceFileId,
      source_name AS sourceName,
      source_path AS sourcePath,
      destination_folder_id AS destinationFolderId
    FROM migration_items
    WHERE migration_id = ?
      AND item_type = 'folder'
      AND status = 'pending'
      AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `).bind(migrationId, afterId, Math.min(80, Math.max(1, Math.floor(limit)))).all<{
    id: string;
    sourceFileId: string;
    sourceName: string;
    sourcePath: string;
    destinationFolderId: string;
  }>();
  return result.results;
}

export function markScanCompleteIfNoFoldersRemain(db: D1Database, migrationId: string) {
  return db.prepare(`
    UPDATE migrations
    SET scan_completed = 1,
        pending_scan_jobs = 0,
        total_files = (
          SELECT COUNT(*) FROM migration_items
          WHERE migration_id = ? AND item_type = 'file'
        ),
        total_bytes = COALESCE((
          SELECT SUM(size) FROM migration_items
          WHERE migration_id = ? AND item_type = 'file'
        ), 0),
        status = CASE WHEN status = 'scanning' THEN 'running' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'scanning'
      AND NOT EXISTS (
        SELECT 1
        FROM migration_items
        WHERE migration_id = ?
          AND item_type = 'folder'
          AND status IN ('pending','copying')
      )
    RETURNING
      id,
      user_id AS userId,
      source_folder_id AS sourceFolderId,
      source_folder_url AS sourceFolderUrl,
      source_folder_name AS sourceFolderName,
      destination_folder_id AS destinationFolderId,
      destination_folder_name AS destinationFolderName,
      destination_root_folder_id AS destinationRootFolderId,
      status,
      scan_completed AS scanCompleted,
      pending_scan_jobs AS pendingScanJobs,
      total_files AS totalFiles,
      completed_files AS completedFiles,
      failed_files AS failedFiles,
      total_bytes AS totalBytes,
      copied_bytes AS copiedBytes,
      error_message AS errorMessage,
      started_at AS startedAt,
      completed_at AS completedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
  `).bind(migrationId, migrationId, migrationId, migrationId).first<GdmMigration>();
}
