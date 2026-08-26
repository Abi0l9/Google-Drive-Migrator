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

export function addMigrationScanTotals(
  db: D1Database,
  migrationId: string,
  discoveredFiles: number,
  discoveredBytes: number,
) {
  return db.prepare(`
    UPDATE migrations
    SET total_files = total_files + ?,
        total_bytes = total_bytes + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    Math.max(0, Math.floor(discoveredFiles)),
    Math.max(0, Math.floor(discoveredBytes)),
    migrationId,
  ).run();
}

export function markScanCompleteIfNoFoldersRemain(db: D1Database, migrationId: string) {
  return db.prepare(`
    UPDATE migrations
    SET scan_completed = 1,
        pending_scan_jobs = 0,
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
  `).bind(migrationId, migrationId).first<GdmMigration>();
}
