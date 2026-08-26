import {
  type DriveFile,
  type MigrationMarker,
  GoogleDriveHttpError,
  assertCopyableDriveFile,
  destinationFileName,
  getPublicWorkspaceExportStream,
  uploadMediaToExistingFile,
  workspaceExportConfig,
} from "@/lib/google/drive-rest";

export async function createPendingWorkspaceDestination(
  accessToken: string,
  file: DriveFile,
  parentId: string,
  marker: MigrationMarker,
) {
  assertCopyableDriveFile(file);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("fields", "id,name,size,appProperties");
  url.searchParams.set("supportsAllDrives", "true");
  return googleJson<DriveFile>(url, accessToken, "POST", {
    name: destinationFileName(file),
    parents: [parentId],
    appProperties: {
      gdmMigrationId: marker.migrationId,
      gdmSourceId: marker.sourceId,
      gdmState: "pending",
    },
  });
}

export async function uploadWorkspaceExport(
  apiKey: string,
  accessToken: string,
  sourceFile: DriveFile,
  destinationFileId: string,
) {
  if (!sourceFile.id || !sourceFile.mimeType) throw new Error("Workspace export is missing source metadata");
  const exportConfig = workspaceExportConfig[sourceFile.mimeType];
  if (!exportConfig) throw new Error(`Unsupported Workspace export type: ${sourceFile.mimeType}`);
  const source = await getPublicWorkspaceExportStream(apiKey, sourceFile.id, exportConfig.mimeType);
  if (!source.body) throw new Error("Google Workspace export did not return a readable body");
  const uploaded = await uploadMediaToExistingFile(
    accessToken,
    destinationFileId,
    source.body,
    exportConfig.mimeType,
  );
  await markWorkspaceDestinationCompleted(accessToken, destinationFileId);
  return uploaded;
}

export function isCompletedWorkspaceDestination(file: DriveFile | undefined) {
  return file?.appProperties?.gdmState === "completed";
}

async function markWorkspaceDestinationCompleted(accessToken: string, destinationFileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(destinationFileId)}`);
  url.searchParams.set("fields", "id,appProperties");
  url.searchParams.set("supportsAllDrives", "true");
  return googleJson<DriveFile>(url, accessToken, "PATCH", {
    appProperties: { gdmState: "completed" },
  });
}

async function googleJson<T>(url: URL, accessToken: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await googleError(response);
  return response.json() as Promise<T>;
}

async function googleError(response: Response) {
  let message = `Google Drive request failed (${response.status})`;
  let reason: string | undefined;
  try {
    const payload = await response.clone().json() as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    message = payload.error?.message || message;
    reason = payload.error?.errors?.[0]?.reason;
  } catch {
    // Preserve the status-only message.
  }
  return new GoogleDriveHttpError(message, response.status, reason, response.headers.get("retry-after"));
}
