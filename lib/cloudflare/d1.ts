import type { MigrationItemStatus, MigrationItemType, MigrationStatus } from "@/types/migration";
import { FreeTierCapacityError, normalizeDailyQueueMessageBudget, utcUsageDate } from "@/lib/cloudflare/free-tier";

export interface GdmUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  googleId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GdmMigration {
  id: string;
  userId: string;
  sourceFolderId: string;
  sourceFolderUrl: string;
  sourceFolderName: string;
  destinationFolderId: string;
  destinationFolderName: string;
  destinationRootFolderId?: string | null;
  status: MigrationStatus;
  scanCompleted: number;
  pendingScanJobs: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  totalBytes: number;
  copiedBytes: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GdmMigrationItem {
  id: string;
  migrationId: string;
  sourceFileId: string;
  sourceName: string;
  sourceMimeType: string;
  sourcePath: string;
  destinationFileId?: string | null;
  destinationFolderId?: string | null;
  itemType: MigrationItemType;
  size: number;
  uploadedBytes: number;
  encryptedUploadSessionUrl?: string | null;
  transferJobId?: string | null;
  transferLeaseUntil?: string | null;
  status: MigrationItemStatus;
  retryCount: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

const USER_COLUMNS = `
  id,
  name,
  email,
  image,
  google_id AS googleId,
  access_token AS accessToken,
  refresh_token AS refreshToken,
  access_token_expires_at AS accessTokenExpiresAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const MIGRATION_COLUMNS = `
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
`;

const ITEM_COLUMNS = `
  id,
  migration_id AS migrationId,
  source_file_id AS sourceFileId,
  source_name AS sourceName,
  source_mime_type AS sourceMimeType,
  source_path AS sourcePath,
  destination_file_id AS destinationFileId,
  destination_folder_id AS destinationFolderId,
  item_type AS itemType,
  size,
  uploaded_bytes AS uploadedBytes,
  encrypted_upload_session_url AS encryptedUploadSessionUrl,
  transfer_job_id AS transferJobId,
  transfer_lease_until AS transferLeaseUntil,
  status,
  retry_count AS retryCount,
  error_message AS errorMessage,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export class ActiveMigrationQuotaError extends Error {
  constructor() {
    super("You already have the maximum number of active migrations. Finish, pause/cancel, or wait for one to complete before starting another.");
    this.name = "ActiveMigrationQuotaError";
  }
}

export async function upsertUser(
  db: D1Database,
  input: {
    name: string;
    email: string;
    image?: string | null;
    googleId: string;
    accessToken: string;
    refreshToken?: string | null;
    accessTokenExpiresAt?: string | null;
  },
) {
  const id = crypto.randomUUID();
  return db.prepare(`
    INSERT INTO users (
      id, name, email, image, google_id, access_token, refresh_token, access_token_expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      image = excluded.image,
      google_id = excluded.google_id,
      access_token = excluded.access_token,
      refresh_token = CASE
        WHEN excluded.refresh_token <> '' THEN excluded.refresh_token
        ELSE users.refresh_token
      END,
      access_token_expires_at = COALESCE(excluded.access_token_expires_at, users.access_token_expires_at),
      updated_at = CURRENT_TIMESTAMP
    RETURNING ${USER_COLUMNS}
  `).bind(
    id,
    input.name,
    input.email.toLowerCase(),
    input.image ?? null,
    input.googleId,
    input.accessToken,
    input.refreshToken ?? "",
    input.accessTokenExpiresAt ?? null,
  ).first<GdmUser>();
}

export function getUserByEmail(db: D1Database, email: string) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`)
    .bind(email.toLowerCase())
    .first<GdmUser>();
}

export function getUserById(db: D1Database, id: string) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<GdmUser>();
}

export function updateUserGoogleTokens(
  db: D1Database,
  userId: string,
  accessToken: string,
  accessTokenExpiresAt: string,
  refreshToken?: string | null,
) {
  return db.prepare(`
    UPDATE users
    SET access_token = ?,
        access_token_expires_at = ?,
        refresh_token = CASE WHEN ? <> '' THEN ? ELSE refresh_token END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(accessToken, accessTokenExpiresAt, refreshToken ?? "", refreshToken ?? "", userId).run();
}

export async function createOrReuseMigration(
  db: D1Database,
  input: {
    userId: string;
    sourceFolderId: string;
    sourceFolderUrl: string;
    sourceFolderName: string;
    destinationFolderId: string;
    destinationFolderName: string;
    maxActive: number;
  },
): Promise<{ migration: GdmMigration; reused: boolean }> {
  const existing = await findActiveDuplicateMigration(
    db,
    input.userId,
    input.sourceFolderId,
    input.destinationFolderId,
  );
  if (existing) return { migration: existing, reused: true };

  const id = crypto.randomUUID();
  const created = await db.prepare(`
    INSERT INTO migrations (
      id,
      user_id,
      source_folder_id,
      source_folder_url,
      source_folder_name,
      destination_folder_id,
      destination_folder_name,
      status,
      pending_scan_jobs,
      updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 1, CURRENT_TIMESTAMP
    WHERE (
      SELECT COUNT(*)
      FROM migrations
      WHERE user_id = ? AND status IN ('pending','scanning','running','paused')
    ) < ?
    ON CONFLICT DO NOTHING
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(
    id,
    input.userId,
    input.sourceFolderId,
    input.sourceFolderUrl,
    input.sourceFolderName,
    input.destinationFolderId,
    input.destinationFolderName,
    input.userId,
    Math.max(1, Math.floor(input.maxActive)),
  ).first<GdmMigration>();

  if (created) return { migration: created, reused: false };

  const racedDuplicate = await findActiveDuplicateMigration(
    db,
    input.userId,
    input.sourceFolderId,
    input.destinationFolderId,
  );
  if (racedDuplicate) return { migration: racedDuplicate, reused: true };

  throw new ActiveMigrationQuotaError();
}

export function findActiveDuplicateMigration(
  db: D1Database,
  userId: string,
  sourceFolderId: string,
  destinationFolderId: string,
) {
  return db.prepare(`
    SELECT ${MIGRATION_COLUMNS}
    FROM migrations
    WHERE user_id = ?
      AND source_folder_id = ?
      AND destination_folder_id = ?
      AND status IN ('pending','scanning','running','paused')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId, sourceFolderId, destinationFolderId).first<GdmMigration>();
}

export function getMigrationById(db: D1Database, migrationId: string) {
  return db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM migrations WHERE id = ? LIMIT 1`)
    .bind(migrationId)
    .first<GdmMigration>();
}

export function getMigrationForUser(db: D1Database, migrationId: string, userId: string) {
  return db.prepare(`SELECT ${MIGRATION_COLUMNS} FROM migrations WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(migrationId, userId)
    .first<GdmMigration>();
}

export async function listMigrationsForUser(db: D1Database, userId: string, limit = 20) {
  const result = await db.prepare(`
    SELECT ${MIGRATION_COLUMNS}
    FROM migrations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(userId, Math.min(100, Math.max(1, Math.floor(limit)))).all<GdmMigration>();
  return result.results;
}

export function setMigrationStatus(
  db: D1Database,
  migrationId: string,
  status: MigrationStatus,
  options: { errorMessage?: string | null; completed?: boolean } = {},
) {
  const completedAt = options.completed ? new Date().toISOString() : null;
  return db.prepare(`
    UPDATE migrations
    SET status = ?,
        error_message = ?,
        completed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, options.errorMessage ?? null, completedAt, completedAt, migrationId).run();
}

export function setMigrationRootFolder(db: D1Database, migrationId: string, destinationRootFolderId: string) {
  return db.prepare(`
    UPDATE migrations
    SET destination_root_folder_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(destinationRootFolderId, migrationId).run();
}

export function markMigrationScanStarted(db: D1Database, migrationId: string) {
  return db.prepare(`
    UPDATE migrations
    SET status = 'scanning',
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending','scanning')
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(migrationId).first<GdmMigration>();
}

export function completeScanJob(
  db: D1Database,
  migrationId: string,
  childScanJobs: number,
  discoveredFiles: number,
  discoveredBytes: number,
) {
  return db.prepare(`
    UPDATE migrations
    SET pending_scan_jobs = MAX(0, pending_scan_jobs + ? - 1),
        total_files = total_files + ?,
        total_bytes = total_bytes + ?,
        scan_completed = CASE WHEN pending_scan_jobs + ? - 1 <= 0 THEN 1 ELSE scan_completed END,
        status = CASE
          WHEN status = 'scanning' AND pending_scan_jobs + ? - 1 <= 0 THEN 'running'
          ELSE status
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(childScanJobs, discoveredFiles, discoveredBytes, childScanJobs, childScanJobs, migrationId)
    .first<GdmMigration>();
}

export function upsertMigrationItem(
  db: D1Database,
  input: {
    migrationId: string;
    sourceFileId: string;
    sourceName: string;
    sourceMimeType: string;
    sourcePath: string;
    destinationFolderId: string;
    itemType: MigrationItemType;
    size?: number;
  },
) {
  const id = crypto.randomUUID();
  return db.prepare(`
    INSERT INTO migration_items (
      id,
      migration_id,
      source_file_id,
      source_name,
      source_mime_type,
      source_path,
      destination_folder_id,
      item_type,
      size,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(migration_id, source_file_id) DO UPDATE SET
      source_name = excluded.source_name,
      source_mime_type = excluded.source_mime_type,
      source_path = excluded.source_path,
      destination_folder_id = excluded.destination_folder_id,
      size = excluded.size,
      updated_at = CURRENT_TIMESTAMP
    RETURNING ${ITEM_COLUMNS}
  `).bind(
    id,
    input.migrationId,
    input.sourceFileId,
    input.sourceName,
    input.sourceMimeType,
    input.sourcePath,
    input.destinationFolderId,
    input.itemType,
    Math.max(0, Math.floor(input.size ?? 0)),
  ).first<GdmMigrationItem>();
}

export function getMigrationItemById(db: D1Database, itemId: string) {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM migration_items WHERE id = ? LIMIT 1`)
    .bind(itemId)
    .first<GdmMigrationItem>();
}

export function getMigrationItemBySource(db: D1Database, migrationId: string, sourceFileId: string) {
  return db.prepare(`
    SELECT ${ITEM_COLUMNS}
    FROM migration_items
    WHERE migration_id = ? AND source_file_id = ?
    LIMIT 1
  `).bind(migrationId, sourceFileId).first<GdmMigrationItem>();
}

export function claimMigrationItem(
  db: D1Database,
  itemId: string,
  jobId: string,
  retryCount: number,
  leaseUntil: string,
  now = new Date().toISOString(),
) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'copying',
        retry_count = ?,
        transfer_job_id = ?,
        transfer_lease_until = ?,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (
        status = 'pending'
        OR (status = 'copying' AND transfer_job_id = ?)
        OR (status = 'copying' AND transfer_lease_until IS NOT NULL AND transfer_lease_until < ?)
      )
    RETURNING ${ITEM_COLUMNS}
  `).bind(retryCount, jobId, leaseUntil, itemId, jobId, now).first<GdmMigrationItem>();
}

export function updateMigrationItemProgress(
  db: D1Database,
  itemId: string,
  uploadedBytes: number,
  leaseUntil: string,
  encryptedUploadSessionUrl?: string | null,
) {
  return db.prepare(`
    UPDATE migration_items
    SET uploaded_bytes = ?,
        transfer_lease_until = ?,
        encrypted_upload_session_url = COALESCE(?, encrypted_upload_session_url),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    Math.max(0, Math.floor(uploadedBytes)),
    leaseUntil,
    encryptedUploadSessionUrl ?? null,
    itemId,
  ).run();
}

export function completeMigrationItem(
  db: D1Database,
  itemId: string,
  destinationFileId: string,
  size: number,
) {
  return db.prepare(`
    UPDATE migration_items
    SET destination_file_id = ?,
        status = 'completed',
        uploaded_bytes = ?,
        encrypted_upload_session_url = NULL,
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(destinationFileId, Math.max(0, Math.floor(size)), itemId).run();
}

export function resetMigrationItemPending(db: D1Database, itemId: string, errorMessage?: string | null) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'pending',
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(errorMessage ?? null, itemId).run();
}

export function failMigrationItem(db: D1Database, itemId: string, retryCount: number, errorMessage: string) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'failed',
        retry_count = ?,
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(retryCount, errorMessage, itemId).run();
}

export async function markPendingItemsSkipped(db: D1Database, migrationId: string, reason: string) {
  return db.prepare(`
    UPDATE migration_items
    SET status = 'skipped',
        error_message = ?,
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE migration_id = ? AND status IN ('pending','copying')
  `).bind(reason, migrationId).run();
}

export async function resetFailedItems(db: D1Database, migrationId: string) {
  const result = await db.prepare(`
    UPDATE migration_items
    SET status = 'pending',
        error_message = NULL,
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE migration_id = ? AND item_type = 'file' AND status = 'failed'
  `).bind(migrationId).run();
  return result.meta.changes ?? 0;
}

export async function listPendingFileItems(db: D1Database, migrationId: string, limit = 50, afterId = "") {
  const result = await db.prepare(`
    SELECT ${ITEM_COLUMNS}
    FROM migration_items
    WHERE migration_id = ?
      AND item_type = 'file'
      AND status = 'pending'
      AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `).bind(migrationId, afterId, Math.min(100, Math.max(1, Math.floor(limit)))).all<GdmMigrationItem>();
  return result.results;
}

export async function listFailedFileItems(db: D1Database, migrationId: string, limit = 10) {
  const result = await db.prepare(`
    SELECT ${ITEM_COLUMNS}
    FROM migration_items
    WHERE migration_id = ? AND item_type = 'file' AND status = 'failed'
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(migrationId, Math.min(100, Math.max(1, Math.floor(limit)))).all<GdmMigrationItem>();
  return result.results;
}

export function getCurrentCopyingItem(db: D1Database, migrationId: string) {
  return db.prepare(`
    SELECT ${ITEM_COLUMNS}
    FROM migration_items
    WHERE migration_id = ? AND item_type = 'file' AND status = 'copying'
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(migrationId).first<GdmMigrationItem>();
}

export function incrementMigrationCompleted(db: D1Database, migrationId: string, copiedBytes: number) {
  return db.prepare(`
    UPDATE migrations
    SET completed_files = completed_files + 1,
        copied_bytes = copied_bytes + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(Math.max(0, Math.floor(copiedBytes)), migrationId).first<GdmMigration>();
}

export function incrementMigrationFailed(db: D1Database, migrationId: string) {
  return db.prepare(`
    UPDATE migrations
    SET failed_files = failed_files + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(migrationId).first<GdmMigration>();
}

export function setMigrationFailedCount(db: D1Database, migrationId: string, failedFiles: number) {
  return db.prepare(`
    UPDATE migrations
    SET failed_files = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(Math.max(0, Math.floor(failedFiles)), migrationId).run();
}

export function finalizeMigrationIfProcessed(db: D1Database, migrationId: string) {
  return db.prepare(`
    UPDATE migrations
    SET status = CASE WHEN failed_files > 0 THEN 'failed' ELSE 'completed' END,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND scan_completed = 1
      AND status = 'running'
      AND completed_files + failed_files >= total_files
    RETURNING ${MIGRATION_COLUMNS}
  `).bind(migrationId).first<GdmMigration>();
}

export async function reserveQueueMessages(
  db: D1Database,
  count = 1,
  configuredBudget?: string | number | null,
) {
  const units = Math.max(1, Math.floor(count));
  const budget = normalizeDailyQueueMessageBudget(configuredBudget);
  if (units > budget) throw new FreeTierCapacityError();
  const usageDate = utcUsageDate();

  const result = await db.prepare(`
    INSERT INTO daily_usage (usage_date, queue_messages, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(usage_date) DO UPDATE SET
      queue_messages = daily_usage.queue_messages + excluded.queue_messages,
      updated_at = CURRENT_TIMESTAMP
    WHERE daily_usage.queue_messages + excluded.queue_messages <= ?
    RETURNING queue_messages AS queueMessages
  `).bind(usageDate, units, budget).first<{ queueMessages: number }>();

  if (!result) throw new FreeTierCapacityError();
  return { used: result.queueMessages, budget, remaining: Math.max(0, budget - result.queueMessages) };
}

export function releaseQueueMessages(db: D1Database, count = 1) {
  const units = Math.max(1, Math.floor(count));
  return db.prepare(`
    UPDATE daily_usage
    SET queue_messages = MAX(0, queue_messages - ?), updated_at = CURRENT_TIMESTAMP
    WHERE usage_date = ?
  `).bind(units, utcUsageDate()).run();
}

export function getTodayUsage(db: D1Database) {
  return db.prepare(`
    SELECT queue_messages AS queueMessages, migrations_created AS migrationsCreated
    FROM daily_usage
    WHERE usage_date = ?
  `).bind(utcUsageDate()).first<{ queueMessages: number; migrationsCreated: number }>();
}

export function touchRuntimeActivity(db: D1Database, key: string, value: string) {
  return db.prepare(`
    INSERT INTO runtime_activity (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run();
}

export function getRuntimeActivity(db: D1Database, key: string) {
  return db.prepare(`
    SELECT value, updated_at AS updatedAt
    FROM runtime_activity
    WHERE key = ?
    LIMIT 1
  `).bind(key).first<{ value: string; updatedAt: string }>();
}
