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
  const patterns = [/\/folders\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/];
  const match = patterns.map((pattern) => folderUrl.match(pattern)?.[1]).find(Boolean);
  if (!match) throw new Error("Invalid Google Drive Folder URL");
  return match;
}

export function publicDrive(apiKey = process.env.GOOGLE_API_KEY) {
  return google.drive({ version: "v3", auth: apiKey });
}

export function userDrive(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

export async function analyzePublicFolder(folderUrl: string): Promise<FolderAnalysis> {
  const folderId = extractDriveFolderId(folderUrl);
  const drive = publicDrive();
  const folder = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType" }).catch(() => {
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
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: 1000,
      pageToken,
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
        size += Number(file.size ?? 0);
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return { files, folders, size };
}

export async function createDestinationFolder(drive: drive_v3.Drive, name: string, parentId?: string) {
  const response = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: parentId ? [parentId] : undefined },
    fields: "id,name",
  });
  return response.data;
}

export async function streamCopyFile(source: drive_v3.Drive, destination: drive_v3.Drive, file: drive_v3.Schema$File, parentId: string) {
  const exportConfig = file.mimeType ? workspaceExports[file.mimeType] : undefined;
  const sourceStream = exportConfig
    ? await source.files.export({ fileId: file.id!, mimeType: exportConfig.mimeType }, { responseType: "stream" })
    : await source.files.get({ fileId: file.id!, alt: "media" }, { responseType: "stream" });
  const name = exportConfig && !file.name?.endsWith(exportConfig.extension) ? `${file.name}${exportConfig.extension}` : file.name;
  return destination.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType: exportConfig?.mimeType ?? file.mimeType ?? "application/octet-stream", body: sourceStream.data as Readable },
    fields: "id,name,size",
  });
}
