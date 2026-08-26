import { drive_v3 } from "googleapis";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { connectDb } from "@/lib/db";
import {
  FOLDER_MIME_TYPE,
  createDestinationFolder,
  findDestinationMigrationItem,
  publicDrive,
  streamCopyFile,
  userDrive,
} from "@/lib/google/drive";
import {
  ResumableUploadCancelledError,
  resumableCopyFile,
  shouldUseResumableUpload,
} from "@/lib/google/resumable-upload";
import { getFreshGoogleAccessToken } from "@/lib/google/user-auth";
import { createMigrationWorker, getReportQueue, getTransferQueue } from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";
import { User } from "@/models/user";

interface ScanJobData {
  migrationId: string;
}

interface TransferJobData {
  migrationId: string;
  itemId: string;
}

interface ClosableWorker {
  close(): Promise<void>;
}

export function registerMigrationWorkers() {
  const workers: ClosableWorker[] = [];

  workers.push(createMigrationWorker<ScanJobData>("scan", async (job: {
    data: ScanJobData;
    attemptsMade: number;
    opts: { attempts?: number };
  }) => {
    await connectDb();

    try {
      const migration = await Migration.findById(job.data.migrationId);
      if (!migration) throw new Error("Migration not found");

      migration.status = "scanning";
      migration.startedAt = migration.startedAt ?? new Date();
      migration.errorMessage = undefined;
      await migration.save();

      const sourceDrive = publicDrive();
      const user = await User.findById(migration.userId);
      if (!user) throw new Error("Migration owner not found");

      const accessToken = await getFreshGoogleAccessToken(user);
      const destinationDrive = userDrive(accessToken);

      const migrationMarker = {
        migrationId: migration._id.toString(),
        sourceId: migration.sourceFolderId,
      };
      let rootDestinationId = migration.destinationRootFolderId as string | undefined;
      if (!rootDestinationId) {
        const existingRoot = await findDestinationMigrationItem(
          destinationDrive,
          migration.destinationFolderId,
          migrationMarker,
          FOLDER_MIME_TYPE,
        );

        rootDestinationId = existingRoot?.id ?? undefined;
        if (!rootDestinationId) {
          const rootFolder = await createDestinationFolder(
            destinationDrive,
            migration.sourceFolderName,
            migration.destinationFolderId,
            migrationMarker,
          );
          rootDestinationId = rootFolder.id ?? undefined;
        }
        if (!rootDestinationId) throw new Error("Unable to create destination root folder");

        migration.destinationRootFolderId = rootDestinationId;
        await migration.save();
      }

      const mappings = new Map<string, string>([[migration.sourceFolderId, rootDestinationId]]);
      const totals = await scanFolder(
        sourceDrive,
        destinationDrive,
        migration._id.toString(),
        migration.sourceFolderId,
        migration.sourceFolderName,
        mappings,
      );

      migration.status = "running";
      migration.totalFiles = totals.files;
      migration.totalBytes = totals.bytes;
      await migration.save();

      const pendingFiles = await MigrationItem.find({
        migrationId: migration._id,
        itemType: "file",
        status: "pending",
      }).select("_id");

      if (pendingFiles.length) {
        await getTransferQueue().addBulk(
          pendingFiles.map((item: { _id: { toString(): string } }) => ({
            name: "transfer-file",
            data: { migrationId: migration._id.toString(), itemId: item._id.toString() },
          })),
        );
      }

      await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
    } catch (error) {
      const attemptsUsed = job.attemptsMade + 1;
      const attemptsAllowed = job.opts.attempts ?? 1;

      if (attemptsUsed >= attemptsAllowed) {
        await Migration.updateOne(
          { _id: job.data.migrationId },
          {
            $set: {
              status: "failed",
              errorMessage: error instanceof Error ? error.message : "Migration scan failed",
              completedAt: new Date(),
            },
          },
        );
      }

      throw error;
    }
  }));

  workers.push(createMigrationWorker<TransferJobData>("transfer", async (job: {
    data: TransferJobData;
    attemptsMade: number;
    opts: { attempts?: number };
  }) => {
    await connectDb();
    const item = await MigrationItem.findById(job.data.itemId);
    const migration = await Migration.findById(job.data.migrationId);
    if (!item || !migration) throw new Error("Migration item not found");

    if (migration.status === "cancelled") {
      if (item.status !== "completed") {
        item.status = "skipped";
        item.errorMessage = "Migration cancelled";
        await item.save();
      }
      await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
      return;
    }

    if (item.status === "completed" && item.destinationFileId) {
      await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
      return;
    }

    const user = await User.findById(migration.userId);
    if (!user) throw new Error("Migration owner not found");
    const accessToken = await getFreshGoogleAccessToken(user);

    item.status = "copying";
    item.retryCount = job.attemptsMade;
    item.errorMessage = undefined;
    await item.save();

    try {
      const sourceDrive = publicDrive();
      const destinationDrive = userDrive(accessToken);
      const marker = { migrationId: migration._id.toString(), sourceId: item.sourceFileId };
      const existingCopy = await findDestinationMigrationItem(
        destinationDrive,
        item.destinationFolderId,
        marker,
      );

      if (existingCopy?.id) {
        item.destinationFileId = existingCopy.id;
        item.status = "completed";
        item.uploadedBytes = item.size;
        item.encryptedUploadSessionUrl = undefined;
        await item.save();
        await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
        return;
      }

      const sourceFile = await sourceDrive.files.get({
        fileId: item.sourceFileId,
        fields: "id,name,mimeType,size",
        supportsAllDrives: true,
      });

      let destinationFileId: string | null | undefined;

      if (shouldUseResumableUpload(sourceFile.data)) {
        let sessionUrl: string | undefined;
        if (item.encryptedUploadSessionUrl) {
          try {
            sessionUrl = decryptToken(item.encryptedUploadSessionUrl);
          } catch {
            item.encryptedUploadSessionUrl = undefined;
            item.uploadedBytes = 0;
            await item.save();
          }
        }

        const uploaded = await resumableCopyFile({
          source: sourceDrive,
          accessToken,
          file: sourceFile.data,
          parentId: item.destinationFolderId,
          marker,
          sessionUrl,
          onSession: async (nextSessionUrl) => {
            item.encryptedUploadSessionUrl = encryptToken(nextSessionUrl);
            await item.save();
          },
          onProgress: async (uploadedBytes) => {
            item.uploadedBytes = uploadedBytes;
            await item.save();
          },
          shouldContinue: async () => {
            const latestMigration = await Migration.findById(migration._id)
              .select("status")
              .lean<{ status?: string }>();
            return Boolean(latestMigration && latestMigration.status !== "cancelled");
          },
        });
        destinationFileId = uploaded.id;
      } else {
        const uploaded = await streamCopyFile(
          sourceDrive,
          destinationDrive,
          sourceFile.data,
          item.destinationFolderId,
          marker,
        );
        destinationFileId = uploaded.data.id;
      }

      if (!destinationFileId) throw new Error("Google Drive upload completed without a destination file ID");

      item.destinationFileId = destinationFileId;
      item.status = "completed";
      item.uploadedBytes = item.size;
      item.encryptedUploadSessionUrl = undefined;
      await item.save();

      await Migration.updateOne(
        { _id: migration._id },
        { $inc: { completedFiles: 1, copiedBytes: item.size } },
      );
      await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
    } catch (error) {
      const latestMigration = await Migration.findById(migration._id)
        .select("status")
        .lean<{ status?: string }>();
      if (error instanceof ResumableUploadCancelledError || latestMigration?.status === "cancelled") {
        item.status = "skipped";
        item.errorMessage = "Migration cancelled";
        await item.save();
        await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
        return;
      }

      const attemptsUsed = job.attemptsMade + 1;
      const attemptsAllowed = job.opts.attempts ?? 1;
      item.retryCount = attemptsUsed;
      item.errorMessage = error instanceof Error ? error.message : "Unknown upload failure";
      item.status = attemptsUsed >= attemptsAllowed ? "failed" : "pending";
      await item.save();

      if (item.status === "failed") {
        await Migration.updateOne({ _id: migration._id }, { $inc: { failedFiles: 1 } });
        await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
      }

      throw error;
    }
  }, 1));

  workers.push(createMigrationWorker<ScanJobData>("report", async (job: { data: ScanJobData }) => {
    await connectDb();
    const migration = await Migration.findById(job.data.migrationId);
    if (!migration) return;

    const [stats] = await MigrationItem.aggregate<{
      completedFiles: number;
      failedFiles: number;
      copiedBytes: number;
    }>([
      { $match: { migrationId: migration._id, itemType: "file" } },
      {
        $group: {
          _id: null,
          completedFiles: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          failedFiles: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          copiedBytes: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$size", 0] } },
        },
      },
    ]);

    migration.completedFiles = stats?.completedFiles ?? 0;
    migration.failedFiles = stats?.failedFiles ?? 0;
    migration.copiedBytes = stats?.copiedBytes ?? 0;

    const processedFiles = migration.completedFiles + migration.failedFiles;
    if (migration.status === "running" && processedFiles >= migration.totalFiles) {
      migration.status = migration.failedFiles > 0 ? "failed" : "completed";
      migration.completedAt = new Date();
    }

    await migration.save();
  }, 1));

  return workers;
}

async function scanFolder(
  drive: drive_v3.Drive,
  destinationDrive: drive_v3.Drive,
  migrationId: string,
  sourceFolderId: string,
  sourcePath: string,
  mappings: Map<string, string>,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${sourceFolderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,size,quotaBytesUsed)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of response.data.files ?? []) {
      const destinationFolderId = mappings.get(sourceFolderId);
      if (!file.id || !destinationFolderId) continue;

      const itemPath = `${sourcePath}/${file.name ?? "Untitled"}`;
      if (file.mimeType === FOLDER_MIME_TYPE) {
        let folderItem = await MigrationItem.findOne({ migrationId, sourceFileId: file.id });
        let childDestinationId = folderItem?.destinationFolderId as string | undefined;

        if (!childDestinationId) {
          const marker = { migrationId, sourceId: file.id };
          const existingFolder = await findDestinationMigrationItem(
            destinationDrive,
            destinationFolderId,
            marker,
            FOLDER_MIME_TYPE,
          );
          let destinationFolderIdForChild = existingFolder?.id ?? undefined;

          if (!destinationFolderIdForChild) {
            const destinationFolder = await createDestinationFolder(
              destinationDrive,
              file.name ?? "Untitled folder",
              destinationFolderId,
              marker,
            );
            destinationFolderIdForChild = destinationFolder.id ?? undefined;
          }
          if (!destinationFolderIdForChild) throw new Error("Unable to create destination folder");

          folderItem = await MigrationItem.findOneAndUpdate(
            { migrationId, sourceFileId: file.id },
            {
              $set: {
                sourceName: file.name ?? "Untitled folder",
                sourceMimeType: file.mimeType,
                sourcePath: itemPath,
                destinationFolderId: destinationFolderIdForChild,
                itemType: "folder",
                status: "completed",
                size: 0,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          );
          childDestinationId = folderItem.destinationFolderId;
        }

        if (!childDestinationId) throw new Error("Unable to map destination folder");
        mappings.set(file.id, childDestinationId);

        const nested = await scanFolder(
          drive,
          destinationDrive,
          migrationId,
          file.id,
          itemPath,
          mappings,
        );
        files += nested.files;
        bytes += nested.bytes;
      } else {
        const size = Number(file.size ?? file.quotaBytesUsed ?? 0);

        await MigrationItem.findOneAndUpdate(
          { migrationId, sourceFileId: file.id },
          {
            $set: {
              sourceName: file.name ?? "Untitled file",
              sourceMimeType: file.mimeType ?? "application/octet-stream",
              sourcePath: itemPath,
              destinationFolderId,
              itemType: "file",
              size,
            },
            $setOnInsert: {
              status: "pending",
              retryCount: 0,
              uploadedBytes: 0,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        files += 1;
        bytes += size;
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { files, bytes };
}
