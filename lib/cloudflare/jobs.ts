export type ScanFolderJob = {
  type: "scan-folder";
  migrationId: string;
  sourceFolderId: string;
  sourceName: string;
  sourcePath: string;
  destinationFolderId: string;
  pageToken?: string;
};

export type TransferFileJob = {
  type: "transfer-file";
  migrationId: string;
  itemId: string;
};

export type DispatchPendingJob = {
  type: "dispatch-pending";
  migrationId: string;
  cursor?: string;
};

export type MigrationJob = ScanFolderJob | TransferFileJob | DispatchPendingJob;

export function isMigrationJob(value: unknown): value is MigrationJob {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "scan-folder" || type === "transfer-file" || type === "dispatch-pending";
}
