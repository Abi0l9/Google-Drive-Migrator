import { drive_v3 } from "googleapis";
import { decryptToken } from "@/lib/crypto";
import { connectDb } from "@/lib/db";
import { FOLDER_MIME_TYPE, createDestinationFolder, publicDrive, streamCopyFile, userDrive } from "@/lib/google/drive";
import { createMigrationWorker, reportQueue, transferQueue } from "@/lib/queue/migrations";
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

interface FolderMapping {
  sourceFolderId: string;
  destinationFolderId: string;
}

export function registerMigrationWorkers() {
  createMigrationWorker<ScanJobData>("scan", async (job: { data: ScanJobData }) => {
    await connectDb();
    const migration = await Migration.findById(job.data.migrationId);
    if (!migration) throw new Error("Migration not found");

    migration.status = "scanning";
    migration.startedAt = migration.startedAt ?? new Date();
    await migration.save();

    const sourceDrive = publicDrive();
    const user = await User.findById(migration.userId);
    const accessToken = decryptToken(user?.accessToken);
    if (!accessToken) throw new Error("Destination Google token unavailable");
    const destinationDrive = userDrive(accessToken);
    const rootFolder = await createDestinationFolder(destinationDrive, migration.sourceFolderName, migration.destinationFolderId);
    const rootDestinationId = rootFolder.id;
    if (!rootDestinationId) throw new Error("Unable to create destination root folder");

    const mappings = new Map<string, string>([[migration.sourceFolderId, rootDestinationId]]);
    const totals = await scanFolder(sourceDrive, destinationDrive, migration._id.toString(), migration.sourceFolderId, migration.sourceFolderName, mappings);

    migration.status = "running";
    migration.totalFiles = totals.files;
    migration.totalBytes = totals.bytes;
    migration.destinationFolderId = rootDestinationId;
    await migration.save();

    const pendingFiles = await MigrationItem.find({ migrationId: migration._id, itemType: "file", status: "pending" }).select("_id");
    await transferQueue.addBulk(pendingFiles.map((item: { _id: { toString(): string } }) => ({ name: "transfer-file", data: { migrationId: migration._id.toString(), itemId: item._id.toString() } })));
  });

  createMigrationWorker<TransferJobData>("transfer", async (job: { data: TransferJobData; attemptsMade: number }) => {
    await connectDb();
    const item = await MigrationItem.findById(job.data.itemId);
    const migration = await Migration.findById(job.data.migrationId);
    if (!item || !migration) throw new Error("Migration item not found");
    const user = await User.findById(migration.userId);
    const accessToken = decryptToken(user?.accessToken);
    if (!accessToken) throw new Error("Destination Google token unavailable");

    item.status = "copying";
    item.retryCount = job.attemptsMade;
    await item.save();

    try {
      const sourceDrive = publicDrive();
      const destinationDrive = userDrive(accessToken);
      const sourceFile = await sourceDrive.files.get({ fileId: item.sourceFileId, fields: "id,name,mimeType,size" });
      const uploaded = await streamCopyFile(sourceDrive, destinationDrive, sourceFile.data, item.destinationFolderId);
      item.destinationFileId = uploaded.data.id;
      item.status = "completed";
      await item.save();
      await Migration.updateOne({ _id: migration._id }, { $inc: { completedFiles: 1, copiedBytes: item.size } });
      await reportQueue.add("refresh-report", { migrationId: migration._id.toString() });
    } catch (error) {
      item.status = "failed";
      item.retryCount = job.attemptsMade + 1;
      item.errorMessage = error instanceof Error ? error.message : "Unknown upload failure";
      await item.save();
      await Migration.updateOne({ _id: migration._id }, { $inc: { failedFiles: 1 } });
      await reportQueue.add("refresh-report", { migrationId: migration._id.toString() });
      throw error;
    }
  });

  createMigrationWorker<ScanJobData>("report", async (job: { data: ScanJobData }) => {
    await connectDb();
    const migration = await Migration.findById(job.data.migrationId);
    if (!migration) return;
    if (migration.completedFiles + migration.failedFiles >= migration.totalFiles) {
      migration.status = migration.failedFiles > 0 ? "failed" : "completed";
      migration.completedAt = new Date();
      await migration.save();
    }
  });
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
      fields: "nextPageToken, files(id,name,mimeType,size)",
      pageSize: 1000,
      pageToken,
    });
    for (const file of response.data.files ?? []) {
      const destinationFolderId = mappings.get(sourceFolderId);
      if (!file.id || !destinationFolderId) continue;
      const itemPath = `${sourcePath}/${file.name ?? "Untitled"}`;
      if (file.mimeType === FOLDER_MIME_TYPE) {
        const destinationFolder = await createDestinationFolder(destinationDrive, file.name ?? "Untitled folder", destinationFolderId);
        if (!destinationFolder.id) throw new Error("Unable to create destination folder");
        const folderItem = await MigrationItem.create({
          migrationId,
          sourceFileId: file.id,
          sourceName: file.name ?? "Untitled folder",
          sourceMimeType: file.mimeType,
          sourcePath: itemPath,
          destinationFolderId: destinationFolder.id,
          itemType: "folder",
          status: "completed",
          size: 0,
        });
        mappings.set(file.id, folderItem.destinationFolderId);
        const nested = await scanFolder(drive, destinationDrive, migrationId, file.id, itemPath, mappings);
        files += nested.files;
        bytes += nested.bytes;
      } else {
        const size = Number(file.size ?? 0);
        await MigrationItem.create({
          migrationId,
          sourceFileId: file.id,
          sourceName: file.name ?? "Untitled file",
          sourceMimeType: file.mimeType ?? "application/octet-stream",
          sourcePath: itemPath,
          destinationFolderId,
          itemType: "file",
          size,
        });
        files += 1;
        bytes += size;
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  await reportQueue.add("refresh-report", { migrationId });
  return { files, bytes };
}
