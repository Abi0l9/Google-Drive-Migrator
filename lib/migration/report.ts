export interface MigrationReportCsvItem {
  type: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  status: string;
  destinationFileId?: string;
  destinationFolderId?: string;
  retryCount: number;
  error?: string;
}

const csvHeader = [
  "type",
  "name",
  "path",
  "mime_type",
  "size_bytes",
  "status",
  "destination_file_id",
  "destination_folder_id",
  "retry_count",
  "error",
];

export function buildMigrationCsv(items: MigrationReportCsvItem[]) {
  const rows: Array<Array<string | number>> = items.map((item) => [
    item.type,
    item.name,
    item.path,
    item.mimeType,
    item.size,
    item.status,
    item.destinationFileId ?? "",
    item.destinationFolderId ?? "",
    item.retryCount,
    item.error ?? "",
  ]);

  return [csvHeader, ...rows]
    .map((row) => row.map(csvValue).join(","))
    .join("\n");
}

export function safeReportFileName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.slice(0, 80) || "migration";
}

export function csvValue(value: string | number) {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
