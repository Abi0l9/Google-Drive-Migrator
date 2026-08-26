import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import type { FolderAnalysis } from "@/types/migration";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const workspaceExports: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" },
  "application/vnd.google-apps.presentation": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
};

export function extractDriveFolderId(folderUrl: string) {
  let url: URL;
  try {
    url = new URL(folderUrl.trim());
  } catch {
    throw new Error("Invalid Google Drive Folder URL");
  }

  if (url.hostname !== "drive.google.com") {
    throw new Error("Invalid Google Drive Folder URL");
  }

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

export function publicDrive(apiKey = process.env.GOOGLE_API_KEY) {
  return google.drive({ version: "v3", auth: apiKey });
}

export function userDrive(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

export async function validateDestinationFolder(drive: drive_v3.Drive, folderRef: string) {
  const folderId = normalizeDriveFolderRef(folderRef);
  if (folderId === "root") return { id: "root", name: "My Drive" };

  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,capabilities(canAddChildren)",
      supportsAllDrives: true,
    });

    if (response.data.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error("Destination must be a Google Drive folder");
    }
    if (response.data.capabilities?.canAddChildren === false) {
      throw new Error("You do not have permission to add files to this destination folder");
    }

    return { id: response.data.id ?? folderId, name: response.data.name ?? "Destination folder" };
  } catch (error) {
    if (error instanceof Error && (
      error.message === "Destination must be a Google Drive folder" ||
      error.message === "You do not have permission to add files to this destination folder"
    )) {
      throw error;
    }
    throw new Error("Destination folder is not accessible to Drive Migrator");
  }
}

export async function analyzePublicFolder(folderUrl: string): Promise<FolderAnalysis> {
  const folderId = extractDriveFolderId(folderUrl);
  const drive = publicDrive();
  const folder = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  }).catch(() => {
    throw new Error("Folder is not publicly accessible");
  });

  if (folder.data.mimeType !== FOLDER_MIME_TYPE) throw new Error("Invalid Google Drive Folder URL");
  const stats = await scanFolderStats(drive, folderId);
  return { folderId, folderName: folder.data.name ?? "Untitled folder", ...stats };
}

async function scanFolderStats(drive: drive_v3.Drive, folderId: string): Promise<{ files: number; folders: number; size: number }> {
  let files = 0;
  let folders = 0;
  let size = 0;
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, quotaBytesUsed)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of response.data.files ?? []) {
      if (file.mimeType === FOLDER_MIME_TYPE) {
        folders += 1;
        const child = await scanFolderStats(drive, file.id!);
        files += child.files;
        folders += child.folders;
        size += child.size;
      } else {
        files += 1;
        size += Number(file.size ?? file.quotaBytesUsed ?? 0);
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { files, folders, size };
}

interface MigrationMarker {
  migrationId: string;
  sourceId: string;
}

function markerProperties(marker?: MigrationMarker) {
  if (!marker) return undefined;
  return { gdmMigrationId: marker.migrationId, gdmSourceId: marker.sourceId };
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findDestinationMigrationItem(
  drive: drive_v3.Drive,
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

  const response = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id,name,mimeType,size)",
    pageSize: 2,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0];
}

export async function createDestinationFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
  marker?: MigrationMarker,
) {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: parentId ? [parentId] : undefined,
      appProperties: markerProperties(marker),
    },
    fields: "id,name",
    supportsAllDrives: true,
  });
  return response.data;
}

export async function streamCopyFile(
  source: drive_v3.Drive,
  destination: drive_v3.Drive,
  file: drive_v3.Schema$File,
  parentId: string,
  marker?: MigrationMarker,
) {
  const exportConfig = file.mimeType ? workspaceExports[file.mimeType] : undefined;
  const sourceStream = exportConfig
    ? await source.files.export({ fileId: file.id!, mimeType: exportConfig.mimeType }, { responseType: "stream" })
    : await source.files.get({ fileId: file.id!, alt: "media", supportsAllDrives: true }, { responseType: "stream" });

  const name = exportConfig && !file.name?.endsWith(exportConfig.extension) ? `${file.name}${exportConfig.extension}` : file.name;

  return destination.files.create({
    requestBody: { name, parents: [parentId], appProperties: markerProperties(marker) },
    media: { mimeType: exportConfig?.mimeType ?? file.mimeType ?? "application/octet-stream", body: sourceStream.data as Readable },
    fields: "id,name,size",
    supportsAllDrives: true,
  });
}
