import type { FolderAnalysis } from "@/types/migration";

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const DRIVE_SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";

export interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  quotaBytesUsed?: string;
  capabilities?: { canAddChildren?: boolean };
  appProperties?: Record<string, string>;
}

export interface DriveFileList {
  files?: DriveFile[];
  nextPageToken?: string;
}

export interface MigrationMarker {
  migrationId: string;
  sourceId: string;
}

export const workspaceExportConfig: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx",
  },
};

export class GoogleDriveHttpError extends Error {
  status: number;
  reason?: string;
  retryAfter?: string | null;

  constructor(message: string, status: number, reason?: string, retryAfter?: string | null) {
    super(message);
    this.name = "GoogleDriveHttpError";
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
  }
}

export class UnsupportedDriveItemError extends Error {
  code = "GDM_UNSUPPORTED_DRIVE_ITEM";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDriveItemError";
  }
}

export function assertCopyableDriveFile(file: DriveFile) {
  const mimeType = file.mimeType ?? "";
  if (mimeType === DRIVE_SHORTCUT_MIME_TYPE) {
    throw new UnsupportedDriveItemError(
      "Google Drive shortcuts are not copied because the destination would still depend on the original source. Replace the shortcut with the actual file or folder before migrating.",
    );
  }
  if (mimeType.startsWith("application/vnd.google-apps.") && !workspaceExportConfig[mimeType]) {
    throw new UnsupportedDriveItemError(
      `This Google Workspace item type (${mimeType}) does not have a supported migration export yet.`,
    );
  }
}

export function destinationFileName(file: DriveFile) {
  const originalName = file.name?.trim() || "Untitled file";
  const exportConfig = file.mimeType ? workspaceExportConfig[file.mimeType] : undefined;
  if (!exportConfig || originalName.toLowerCase().endsWith(exportConfig.extension.toLowerCase())) {
    return originalName;
  }
  return `${originalName}${exportConfig.extension}`;
}

export function extractDriveFolderId(folderUrl: string) {
  let url: URL;
  try {
    url = new URL(folderUrl.trim());
  } catch {
    throw new Error("Invalid Google Drive Folder URL");
  }
  if (url.hostname !== "drive.google.com") throw new Error("Invalid Google Drive Folder URL");
  const pathMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = pathMatch?.[1] ?? url.searchParams.get("id");
  if (!folderId || !/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    throw new Error("Invalid Google Drive Folder URL");
  }
  return folderId;
}

export function normalizeDriveFolderRef(folderRef: string) {
  const value = folderRef.trim();
  if (value === "root") return "root";
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return extractDriveFolderId(value);
}

export async function getPublicDriveFile(apiKey: string, fileId: string, fields = "id,name,mimeType,size,quotaBytesUsed") {
  const url = driveApiUrl(`/files/${encodeURIComponent(fileId)}`, {
    key: apiKey,
    fields,
    supportsAllDrives: "true",
  });
  return driveFetch<DriveFile>(url);
}

export async function listPublicDriveChildren(
  apiKey: string,
  folderId: string,
  pageToken?: string,
  pageSize = 1000,
) {
  const url = driveApiUrl("/files", {
    key: apiKey,
    q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,size,quotaBytesUsed)",
    pageSize: String(Math.min(1000, Math.max(1, pageSize))),
    pageToken,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  return driveFetch<DriveFileList>(url);
}

export async function validateDestinationFolder(accessToken: string, folderRef: string) {
  const folderId = normalizeDriveFolderRef(folderRef);
  if (folderId === "root") return { id: "root", name: "My Drive" };
  const url = driveApiUrl(`/files/${encodeURIComponent(folderId)}`, {
    fields: "id,name,mimeType,capabilities(canAddChildren)",
    supportsAllDrives: "true",
  });
  const folder = await driveFetch<DriveFile>(url, { accessToken });
  if (folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) throw new Error("Destination must be a Google Drive folder");
  if (folder.capabilities?.canAddChildren === false) {
    throw new Error("You do not have permission to add files to this destination folder");
  }
  return { id: folder.id ?? folderId, name: folder.name ?? "Destination folder" };
}

export async function findDestinationMigrationItem(
  accessToken: string,
  parentId: string,
  marker: MigrationMarker,
  mimeType?: string,
) {
  const clauses = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    "trashed = false",
    `appProperties has { key='gdmMigrationId' and value='${escapeDriveQueryValue(marker.migrationId)}' }`,
    `appProperties has { key='gdmSourceId' and value='${escapeDriveQueryValue(marker.sourceId)}' }`,
  ];
  if (mimeType) clauses.push(`mimeType='${escapeDriveQueryValue(mimeType)}'`);
  const url = driveApiUrl("/files", {
    q: clauses.join(" and "),
    fields: "files(id,name,mimeType,size,appProperties)",
    pageSize: "2",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const result = await driveFetch<DriveFileList>(url, { accessToken });
  return result.files?.[0];
}

export async function createDestinationFolder(
  accessToken: string,
  name: string,
  parentId: string | undefined,
  marker?: MigrationMarker,
) {
  const url = driveApiUrl("/files", { fields: "id,name", supportsAllDrives: "true" });
  return driveFetch<DriveFile>(url, {
    accessToken,
    method: "POST",
    json: {
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: parentId ? [parentId] : undefined,
      appProperties: markerProperties(marker),
    },
  });
}

export async function createDestinationFileMetadata(
  accessToken: string,
  file: DriveFile,
  parentId: string,
  marker: MigrationMarker,
) {
  assertCopyableDriveFile(file);
  const url = driveApiUrl("/files", { fields: "id,name,size", supportsAllDrives: "true" });
  return driveFetch<DriveFile>(url, {
    accessToken,
    method: "POST",
    json: {
      name: destinationFileName(file),
      parents: [parentId],
      appProperties: markerProperties(marker),
    },
  });
}

export async function getPublicFileStream(apiKey: string, fileId: string, range?: string) {
  const url = driveApiUrl(`/files/${encodeURIComponent(fileId)}`, {
    key: apiKey,
    alt: "media",
    supportsAllDrives: "true",
  });
  return driveFetchResponse(url, { headers: range ? { Range: range } : undefined });
}

export async function getPublicWorkspaceExportStream(apiKey: string, fileId: string, mimeType: string) {
  const url = driveApiUrl(`/files/${encodeURIComponent(fileId)}/export`, { key: apiKey, mimeType });
  return driveFetchResponse(url);
}

export async function uploadMediaToExistingFile(
  accessToken: string,
  destinationFileId: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
) {
  const url = driveUploadUrl(`/files/${encodeURIComponent(destinationFileId)}`, {
    uploadType: "media",
    fields: "id,name,size",
    supportsAllDrives: "true",
  });
  return driveFetch<DriveFile>(url, {
    accessToken,
    method: "PATCH",
    headers: { "Content-Type": contentType },
    body,
  });
}

export async function analyzePublicFolder(apiKey: string, folderUrl: string): Promise<FolderAnalysis> {
  const folderId = extractDriveFolderId(folderUrl);
  const folder = await getPublicDriveFile(apiKey, folderId, "id,name,mimeType").catch(() => {
    throw new Error("Folder is not publicly accessible");
  });
  if (folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) throw new Error("Invalid Google Drive Folder URL");
  const stats = await scanFolderStats(apiKey, folderId, 40);
  return { folderId, folderName: folder.name ?? "Untitled folder", ...stats };
}

async function scanFolderStats(
  apiKey: string,
  folderId: string,
  remainingSubrequests: number,
): Promise<{ files: number; folders: number; size: number; used: number }> {
  if (remainingSubrequests <= 0) {
    throw new Error("This folder is too large to analyze instantly on the free runtime. You can still start a migration and let the background scanner process it.");
  }
  let files = 0;
  let folders = 0;
  let size = 0;
  let used = 0;
  let pageToken: string | undefined;
  do {
    if (used >= remainingSubrequests) {
      throw new Error("This folder is too large to analyze instantly on the free runtime. You can still start a migration and let the background scanner process it.");
    }
    const response = await listPublicDriveChildren(apiKey, folderId, pageToken);
    used += 1;
    for (const file of response.files ?? []) {
      if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
        folders += 1;
        const child = await scanFolderStats(apiKey, file.id!, remainingSubrequests - used);
        files += child.files;
        folders += child.folders;
        size += child.size;
        used += child.used;
      } else {
        files += 1;
        size += Number(file.size ?? file.quotaBytesUsed ?? 0);
      }
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  return { files, folders, size, used };
}

function markerProperties(marker?: MigrationMarker) {
  if (!marker) return undefined;
  return { gdmMigrationId: marker.migrationId, gdmSourceId: marker.sourceId };
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveApiUrl(path: string, params: Record<string, string | undefined>) {
  return googleUrl("https://www.googleapis.com/drive/v3", path, params);
}

function driveUploadUrl(path: string, params: Record<string, string | undefined>) {
  return googleUrl("https://www.googleapis.com/upload/drive/v3", path, params);
}

function googleUrl(base: string, path: string, params: Record<string, string | undefined>) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

interface DriveFetchOptions {
  accessToken?: string;
  method?: string;
  headers?: HeadersInit;
  json?: unknown;
  body?: BodyInit | ReadableStream<Uint8Array>;
}

async function driveFetch<T>(url: URL, options: DriveFetchOptions = {}) {
  const response = await driveFetchResponse(url, options);
  return response.json<T>();
}

async function driveFetchResponse(url: URL, options: DriveFetchOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json; charset=UTF-8");
    body = JSON.stringify(options.json);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  if (!response.ok) throw await googleDriveHttpError(response);
  return response;
}

async function googleDriveHttpError(response: Response) {
  let message = `Google Drive request failed (${response.status})`;
  let reason: string | undefined;
  try {
    const payload = await response.clone().json<{
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    }>();
    message = payload.error?.message || message;
    reason = payload.error?.errors?.[0]?.reason;
  } catch {
    // Keep the status-based message when Google returns a non-JSON error.
  }
  return new GoogleDriveHttpError(message, response.status, reason, response.headers.get("retry-after"));
}
