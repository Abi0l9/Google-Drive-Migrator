import { decryptToken, encryptToken } from "@/lib/crypto";
import {
  type GdmMigrationItem,
  claimMigrationItem,
  completeMigrationItem,
  finalizeMigrationIfProcessed,
  getMigrationById,
  getMigrationItemById,
  getMigrationItemBySource,
  getUserById,
  incrementMigrationCompleted,
  incrementMigrationFailed,
  listPendingFileItems,
  markPendingItemsSkipped,
  resetMigrationItemPending,
  setMigrationRootFolder,
  setMigrationStatus,
  touchRuntimeActivity,
  upsertMigrationItem,
} from "@/lib/cloudflare/d1";
import {
  claimFolderScan,
  completeFolderScan,
  continueFolderScan,
  listPendingFolderItems,
  markScanCompleteIfNoFoldersRemain,
} from "@/lib/cloudflare/d1-jobs";
import { FreeTierCapacityError } from "@/lib/cloudflare/free-tier";
import {
  type DispatchPendingJob,
  type MigrationJob,
  type ScanFolderJob,
  type TransferFileJob,
  isMigrationJob,
} from "@/lib/cloudflare/jobs";
import { publishMigrationJob, publishMigrationJobs } from "@/lib/cloudflare/queue";
import {
  DRIVE_FOLDER_MIME_TYPE,
  assertCopyableDriveFile,
  createDestinationFileMetadata,
  createDestinationFolder,
  findDestinationMigrationItem,
  getPublicDriveFile,
  listPublicDriveChildren,
  workspaceExportConfig,
} from "@/lib/google/drive-rest";
import { classifyGoogleDriveError, googleDriveErrorDetails } from "@/lib/google/error-classification";
import {
  ResumableUploadInterruptedError,
  continueResumableCopy,
} from "@/lib/google/resumable-rest";
import { getFreshGoogleAccessTokenD1 } from "@/lib/google/user-auth-d1";
import {
  createPendingWorkspaceDestination,
  isCompletedWorkspaceDestination,
  uploadWorkspaceExport,
} from "@/lib/google/workspace-rest";

const LEASE_MS = 10 * 60 * 1000;
const DISPATCH_BATCH_SIZE = 30;

export default {
  async queue(batch: MessageBatch<MigrationJob>, env: CloudflareJobsEnv): Promise<void> {
    await touchRuntimeActivity(env.DB, "jobs:last_batch", new Date().toISOString());

    for (const message of batch.messages) {
      if (!isMigrationJob(message.body)) {
        console.warn(JSON.stringify({ event: "queue.invalid_message", messageId: message.id }));
        message.ack();
        continue;
      }

      try {
        await processJob(env, message);
        await touchRuntimeActivity(env.DB, "jobs:last_success", new Date().toISOString());
        message.ack();
      } catch (error) {
        await handleJobFailure(env, message, error);
      }
    }
  },
} satisfies ExportedHandler<CloudflareJobsEnv>;

async function processJob(env: CloudflareJobsEnv, message: Message<MigrationJob>) {
  switch (message.body.type) {
    case "scan-folder":
      return processScanFolder(env, message, message.body);
    case "transfer-file":
      return processTransferFile(env, message, message.body);
    case "dispatch-pending":
      return processDispatchPending(env, message.body);
  }
}

async function processScanFolder(
  env: CloudflareJobsEnv,
  message: Message<MigrationJob>,
  job: ScanFolderJob,
) {
  let migration = await getMigrationById(env.DB, job.migrationId);
  if (!migration) return;
  if (["completed", "failed"].includes(migration.status)) return;
  if (migration.status === "cancelled") {
    await markPendingItemsSkipped(env.DB, migration.id, "Migration cancelled");
    return;
  }
  if (migration.status === "paused") return;

  if (migration.status === "pending") {
    await env.DB.prepare(`
      UPDATE migrations
      SET status = 'scanning', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).bind(migration.id).run();
    migration = (await getMigrationById(env.DB, migration.id)) ?? migration;
  }
  if (migration.status !== "scanning") return;

  const user = await getUserById(env.DB, migration.userId);
  if (!user) throw new Error("Migration owner not found");
  const accessToken = await getFreshGoogleAccessTokenD1(env, user);

  let destinationFolderId = job.destinationFolderId;
  if (job.sourceFolderId === migration.sourceFolderId) {
    const rootMarker = { migrationId: migration.id, sourceId: migration.sourceFolderId };
    let rootId = migration.destinationRootFolderId ?? undefined;
    if (!rootId) {
      const existing = await findDestinationMigrationItem(
        accessToken,
        migration.destinationFolderId,
        rootMarker,
        DRIVE_FOLDER_MIME_TYPE,
      );
      rootId = existing?.id;
      if (!rootId) {
        const created = await createDestinationFolder(
          accessToken,
          migration.sourceFolderName,
          migration.destinationFolderId,
          rootMarker,
        );
        rootId = created.id;
      }
      if (!rootId) throw new Error("Unable to create destination migration root folder");
      await setMigrationRootFolder(env.DB, migration.id, rootId);
    }
    destinationFolderId = rootId;
  }

  const folderItem = await upsertMigrationItem(env.DB, {
    migrationId: migration.id,
    sourceFileId: job.sourceFolderId,
    sourceName: job.sourceName,
    sourceMimeType: DRIVE_FOLDER_MIME_TYPE,
    sourcePath: job.sourcePath,
    destinationFolderId,
    itemType: "folder",
  });
  if (!folderItem || folderItem.status === "completed") return;

  const claimed = await claimFolderScan(
    env.DB,
    migration.id,
    job.sourceFolderId,
    message.id,
    nextLease(),
  );
  if (!claimed) return;

  const page = await listPublicDriveChildren(
    env.GOOGLE_API_KEY,
    job.sourceFolderId,
    job.pageToken,
  );

  const scanJobs: ScanFolderJob[] = [];
  for (const source of page.files ?? []) {
    if (!source.id) continue;
    const sourceName = source.name?.trim() || "Untitled item";
    const sourcePath = `${job.sourcePath}/${sourceName}`;

    if (source.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      const marker = { migrationId: migration.id, sourceId: source.id };
      let destinationChild = await findDestinationMigrationItem(
        accessToken,
        destinationFolderId,
        marker,
        DRIVE_FOLDER_MIME_TYPE,
      );
      if (!destinationChild?.id) {
        destinationChild = await createDestinationFolder(
          accessToken,
          sourceName,
          destinationFolderId,
          marker,
        );
      }
      if (!destinationChild.id) throw new Error(`Unable to create destination folder for ${sourcePath}`);

      const childItem = await upsertMigrationItem(env.DB, {
        migrationId: migration.id,
        sourceFileId: source.id,
        sourceName,
        sourceMimeType: DRIVE_FOLDER_MIME_TYPE,
        sourcePath,
        destinationFolderId: destinationChild.id,
        itemType: "folder",
      });
      if (childItem?.status !== "completed") {
        scanJobs.push({
          type: "scan-folder",
          migrationId: migration.id,
          sourceFolderId: source.id,
          sourceName,
          sourcePath,
          destinationFolderId: destinationChild.id,
        });
      }
      continue;
    }

    await upsertMigrationItem(env.DB, {
      migrationId: migration.id,
      sourceFileId: source.id,
      sourceName,
      sourceMimeType: source.mimeType ?? "application/octet-stream",
      sourcePath,
      destinationFolderId,
      itemType: "file",
      size: Number(source.size ?? source.quotaBytesUsed ?? 0),
    });
  }

  if (page.nextPageToken) {
    await continueFolderScan(env.DB, claimed.id);
    scanJobs.push({ ...job, pageToken: page.nextPageToken, destinationFolderId });
  } else {
    await completeFolderScan(env.DB, claimed.id);
  }

  if (scanJobs.length) await publishMigrationJobs(env, scanJobs);

  const completedScan = await markScanCompleteIfNoFoldersRemain(env.DB, migration.id);
  if (completedScan?.status === "running") {
    await publishMigrationJob(env, { type: "dispatch-pending", migrationId: migration.id });
  }
}

async function processDispatchPending(env: CloudflareJobsEnv, job: DispatchPendingJob) {
  const migration = await getMigrationById(env.DB, job.migrationId);
  if (!migration || ["completed", "failed", "cancelled", "paused"].includes(migration.status)) return;

  if (!migration.scanCompleted) {
    const folders = await listPendingFolderItems(env.DB, migration.id, DISPATCH_BATCH_SIZE, job.cursor ?? "");
    if (!folders.length) {
      const completed = await markScanCompleteIfNoFoldersRemain(env.DB, migration.id);
      if (completed?.status === "running") {
        await publishMigrationJob(env, { type: "dispatch-pending", migrationId: migration.id });
      }
      return;
    }
    await publishMigrationJobs(env, folders.map((folder) => ({
      type: "scan-folder" as const,
      migrationId: migration.id,
      sourceFolderId: folder.sourceFileId,
      sourceName: folder.sourceName,
      sourcePath: folder.sourcePath,
      destinationFolderId: folder.destinationFolderId,
    })));
    if (folders.length === DISPATCH_BATCH_SIZE) {
      await publishMigrationJob(env, {
        type: "dispatch-pending",
        migrationId: migration.id,
        cursor: folders.at(-1)?.id,
      });
    }
    return;
  }

  if (migration.status !== "running") return;
  const items = await listPendingFileItems(env.DB, migration.id, DISPATCH_BATCH_SIZE, job.cursor ?? "");
  if (!items.length) {
    await finalizeMigrationIfProcessed(env.DB, migration.id);
    return;
  }

  await publishMigrationJobs(env, items.map((item) => ({
    type: "transfer-file" as const,
    migrationId: migration.id,
    itemId: item.id,
  })));
  if (items.length === DISPATCH_BATCH_SIZE) {
    await publishMigrationJob(env, {
      type: "dispatch-pending",
      migrationId: migration.id,
      cursor: items.at(-1)?.id,
    });
  }
}

async function processTransferFile(
  env: CloudflareJobsEnv,
  message: Message<MigrationJob>,
  job: TransferFileJob,
) {
  const migration = await getMigrationById(env.DB, job.migrationId);
  if (!migration) return;
  const currentItem = await getMigrationItemById(env.DB, job.itemId);
  if (!currentItem) return;

  if (migration.status === "paused") {
    if (currentItem.status === "copying") await resetMigrationItemPending(env.DB, currentItem.id);
    return;
  }
  if (migration.status === "cancelled") {
    await markPendingItemsSkipped(env.DB, migration.id, "Migration cancelled");
    return;
  }
  if (migration.status !== "running") return;
  if (currentItem.status === "completed" && currentItem.destinationFileId) return;

  const item = await claimMigrationItem(
    env.DB,
    currentItem.id,
    message.id,
    Math.max(0, message.attempts - 1),
    nextLease(),
  );
  if (!item) return;

  const user = await getUserById(env.DB, migration.userId);
  if (!user) throw new Error("Migration owner not found");
  const accessToken = await getFreshGoogleAccessTokenD1(env, user);
  const sourceFile = await getPublicDriveFile(
    env.GOOGLE_API_KEY,
    item.sourceFileId,
    "id,name,mimeType,size,quotaBytesUsed",
  );
  assertCopyableDriveFile(sourceFile);
  const marker = { migrationId: migration.id, sourceId: item.sourceFileId };
  const workspace = sourceFile.mimeType ? workspaceExportConfig[sourceFile.mimeType] : undefined;
  const existing = await findDestinationMigrationItem(
    accessToken,
    item.destinationFolderId ?? migration.destinationRootFolderId ?? migration.destinationFolderId,
    marker,
  );

  if (!workspace && existing?.id) {
    await finishTransferredItem(env, item, existing.id);
    return;
  }
  if (workspace && existing?.id && isCompletedWorkspaceDestination(existing)) {
    await finishTransferredItem(env, item, existing.id);
    return;
  }

  const parentId = item.destinationFolderId ?? migration.destinationRootFolderId ?? migration.destinationFolderId;
  if (workspace) {
    let destinationId = existing?.id;
    if (!destinationId) {
      const pending = await createPendingWorkspaceDestination(accessToken, sourceFile, parentId, marker);
      destinationId = pending.id;
    }
    if (!destinationId) throw new Error("Unable to create Workspace export destination");
    await uploadWorkspaceExport(env.GOOGLE_API_KEY, accessToken, sourceFile, destinationId);
    await finishTransferredItem(env, item, destinationId);
    return;
  }

  const size = Number(sourceFile.size ?? item.size ?? 0);
  if (size <= 0) {
    const created = await createDestinationFileMetadata(accessToken, sourceFile, parentId, marker);
    if (!created.id) throw new Error("Unable to create zero-byte destination file");
    await finishTransferredItem(env, item, created.id);
    return;
  }

  let sessionUrl: string | undefined;
  if (item.encryptedUploadSessionUrl) {
    try {
      sessionUrl = decryptToken(item.encryptedUploadSessionUrl, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      await updateUploadState(env, item, 0, undefined);
    }
  }

  const result = await continueResumableCopy({
    apiKey: env.GOOGLE_API_KEY,
    accessToken,
    file: sourceFile,
    parentId,
    marker,
    sessionUrl,
    onSession: async (nextSession) => {
      const encrypted = encryptToken(nextSession, env.TOKEN_ENCRYPTION_KEY);
      if (!encrypted) throw new Error("Unable to store resumable upload session");
      await updateUploadState(env, item, item.uploadedBytes, encrypted);
      item.encryptedUploadSessionUrl = encrypted;
    },
    onProgress: async (uploadedBytes) => {
      item.uploadedBytes = uploadedBytes;
      await updateUploadState(env, item, uploadedBytes, item.encryptedUploadSessionUrl);
    },
    shouldContinue: async () => {
      const latest = await getMigrationById(env.DB, migration.id);
      return Boolean(latest && latest.status === "running");
    },
  });

  if (!result.completed) {
    await resetMigrationItemPending(env.DB, item.id);
    await publishMigrationJob(env, { type: "transfer-file", migrationId: migration.id, itemId: item.id });
    return;
  }
  if (!result.file.id) throw new Error("Google Drive upload completed without a destination file ID");
  await finishTransferredItem(env, item, result.file.id);
}

async function finishTransferredItem(env: CloudflareJobsEnv, item: GdmMigrationItem, destinationFileId: string) {
  await completeMigrationItem(env.DB, item.id, destinationFileId, item.size);
  await incrementMigrationCompleted(env.DB, item.migrationId, item.size);
  await finalizeMigrationIfProcessed(env.DB, item.migrationId);
}

async function updateUploadState(
  env: CloudflareJobsEnv,
  item: GdmMigrationItem,
  uploadedBytes: number,
  encryptedSession?: string,
) {
  await env.DB.prepare(`
    UPDATE migration_items
    SET uploaded_bytes = ?,
        encrypted_upload_session_url = COALESCE(?, encrypted_upload_session_url),
        transfer_lease_until = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(Math.max(0, Math.floor(uploadedBytes)), encryptedSession ?? null, nextLease(), item.id).run();
}

async function handleJobFailure(
  env: CloudflareJobsEnv,
  message: Message<MigrationJob>,
  error: unknown,
) {
  const job = message.body;
  const migration = isMigrationJob(job) ? await getMigrationById(env.DB, job.migrationId) : null;
  const details = googleDriveErrorDetails(error);
  console.error(JSON.stringify({
    event: "queue.job_failed",
    messageId: message.id,
    jobType: isMigrationJob(job) ? job.type : "unknown",
    attempts: message.attempts,
    error: details.message,
  }));

  if (error instanceof FreeTierCapacityError) {
    if (job.type === "transfer-file") await resetMigrationItemPending(env.DB, job.itemId, error.message);
    if (job.type === "scan-folder") {
      const folder = await getMigrationItemBySource(env.DB, job.migrationId, job.sourceFolderId);
      if (folder) await resetMigrationItemPending(env.DB, folder.id, error.message);
    }
    if (migration) await setMigrationStatus(env.DB, migration.id, "paused", { errorMessage: error.message });
    message.ack();
    return;
  }

  if (error instanceof ResumableUploadInterruptedError) {
    if (job.type === "transfer-file") await resetMigrationItemPending(env.DB, job.itemId);
    message.ack();
    return;
  }

  if (migration?.status === "paused" || migration?.status === "cancelled") {
    if (job.type === "transfer-file") await resetMigrationItemPending(env.DB, job.itemId);
    message.ack();
    return;
  }

  const classification = classifyGoogleDriveError(error);
  const finalAttempt = message.attempts >= 3;
  const permanent = classification === "permanent";

  if (!permanent && !finalAttempt) {
    if (job.type === "transfer-file") await resetMigrationItemPending(env.DB, job.itemId, details.message);
    if (job.type === "scan-folder") {
      const folder = await getMigrationItemBySource(env.DB, job.migrationId, job.sourceFolderId);
      if (folder) await resetMigrationItemPending(env.DB, folder.id, details.message);
    }
    message.retry({ delaySeconds: Math.min(900, 5 * 2 ** Math.max(0, message.attempts - 1)) });
    return;
  }

  if (job.type === "transfer-file") {
    const item = await getMigrationItemById(env.DB, job.itemId);
    if (item && item.status !== "completed") {
      await env.DB.prepare(`
        UPDATE migration_items
        SET status = 'failed',
            retry_count = ?,
            error_message = ?,
            transfer_job_id = NULL,
            transfer_lease_until = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(message.attempts, details.message, item.id).run();
      await incrementMigrationFailed(env.DB, job.migrationId);
      await finalizeMigrationIfProcessed(env.DB, job.migrationId);
    }
    message.ack();
    return;
  }

  if (migration) {
    await setMigrationStatus(env.DB, migration.id, "failed", {
      errorMessage: details.message,
      completed: true,
    });
  }
  message.ack();
}

function nextLease() {
  return new Date(Date.now() + LEASE_MS).toISOString();
}
