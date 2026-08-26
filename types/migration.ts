export type MigrationStatus = "pending" | "scanning" | "running" | "completed" | "failed" | "cancelled";
export type MigrationItemStatus = "pending" | "copying" | "completed" | "failed" | "skipped";
export type MigrationItemType = "file" | "folder";

export interface FolderAnalysis {
  folderId: string;
  folderName: string;
  files: number;
  folders: number;
  size: number;
}

export interface ProgressSnapshot {
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFile?: string;
  percentage: number;
  status?: MigrationStatus;
  copiedBytes?: number;
  totalBytes?: number;
}
