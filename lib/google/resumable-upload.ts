import { drive_v3 } from "googleapis";

export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const RESUMABLE_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

const workspaceMimeTypes = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);

interface MigrationMarker {
  migrationId: string;
  sourceId: string;
}

interface ResumableCopyOptions {
  source: drive_v3.Drive;
  accessToken: string;
  file: drive_v3.Schema$File;
  parentId: string;
  marker: MigrationMarker;
  sessionUrl?: string;
  onSession?: (sessionUrl: string) => Promise<void> | void;
  onProgress?: (uploadedBytes: number) => Promise<void> | void;
  shouldContinue?: () => Promise<boolean> | boolean;
}

export class ResumableUploadCancelledError extends Error {
  constructor() {
    super("Migration cancelled");
    this.name = "ResumableUploadCancelledError";
  }
}

interface ResumableSessionStatus {
  offset: number;
  expired?: boolean;
  completedFile?: drive_v3.Schema$File;
}

export function shouldUseResumableUpload(file: drive_v3.Schema$File) {
  const size = Number(file.size ?? 0);
  return size > RESUMABLE_UPLOAD_THRESHOLD_BYTES && !workspaceMimeTypes.has(file.mimeType ?? "");
}

export async function resumableCopyFile(options: ResumableCopyOptions): Promise<drive_v3.Schema$File> {
  const totalSize = Number(options.file.size ?? 0);
  if (!options.file.id || totalSize <= 0) {
    throw new Error("Resumable upload requires a downloadable file with a known size");
  }

  await assertUploadCanContinue(options);

  let activeSessionUrl: string;
  let offset = 0;

  if (options.sessionUrl) {
    const status = await queryResumableSession(options.sessionUrl, totalSize);
    if (status.completedFile) return status.completedFile;

    if (status.expired) {
      await options.onProgress?.(0);
      activeSessionUrl = await createResumableSession(
        options.accessToken,
        options.file,
        options.parentId,
        options.marker,
        totalSize,
      );
      await options.onSession?.(activeSessionUrl);
    } else {
      offset = status.offset;
      activeSessionUrl = options.sessionUrl;
      await options.onProgress?.(offset);
    }
  } else {
    activeSessionUrl = await createResumableSession(
      options.accessToken,
      options.file,
      options.parentId,
      options.marker,
      totalSize,
    );
    await options.onSession?.(activeSessionUrl);
  }

  while (offset < totalSize) {
    await assertUploadCanContinue(options);
    const end = Math.min(offset + RESUMABLE_CHUNK_SIZE_BYTES, totalSize) - 1;
    const chunk = await downloadSourceRange(options.source, options.file.id, offset, end);
    const expectedLength = end - offset + 1;

    if (chunk.byteLength !== expectedLength) {
      throw new Error(`Source partial download returned ${chunk.byteLength} bytes; expected ${expectedLength}`);
    }

    const response: Response = await fetch(activeSessionUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Type": options.file.mimeType ?? "application/octet-stream",
        "Content-Range": `bytes ${offset}-${end}/${totalSize}`,
      },
      body: chunk,
    });

    const rotatedSessionUrl: string | null = response.headers.get("location");
    if (rotatedSessionUrl && rotatedSessionUrl !== activeSessionUrl) {
      activeSessionUrl = rotatedSessionUrl;
      await options.onSession?.(activeSessionUrl);
    }

    if (response.status === 308) {
      const confirmedOffset = parseConfirmedOffset(response.headers.get("range"));
      const nextOffset = confirmedOffset ?? end + 1;
      if (nextOffset <= offset) throw new Error("Google Drive resumable upload did not advance");
      offset = Math.min(nextOffset, totalSize);
      await options.onProgress?.(offset);
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      activeSessionUrl = await createResumableSession(
        options.accessToken,
        options.file,
        options.parentId,
        options.marker,
        totalSize,
      );
      offset = 0;
      await options.onSession?.(activeSessionUrl);
      await options.onProgress?.(0);
      continue;
    }

    if (!response.ok) {
      throw new Error(await resumableUploadError(response));
    }

    const uploaded = await response.json() as drive_v3.Schema$File;
    await options.onProgress?.(totalSize);
    return uploaded;
  }

  throw new Error("Google Drive resumable upload ended without a completed file response");
}

async function assertUploadCanContinue(options: ResumableCopyOptions) {
  if (!options.shouldContinue) return;
  const shouldContinue = await options.shouldContinue();
  if (!shouldContinue) throw new ResumableUploadCancelledError();
}

async function createResumableSession(
  accessToken: string,
  file: drive_v3.Schema$File,
  parentId: string,
  marker: MigrationMarker,
  totalSize: number,
) {
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,size");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType ?? "application/octet-stream",
      "X-Upload-Content-Length": String(totalSize),
    },
    body: JSON.stringify({
      name: file.name ?? "Untitled file",
      parents: [parentId],
      appProperties: {
        gdmMigrationId: marker.migrationId,
        gdmSourceId: marker.sourceId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await resumableUploadError(response));
  }

  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("Google Drive did not return a resumable upload session");
  return sessionUrl;
}

async function queryResumableSession(sessionUrl: string, totalSize: number): Promise<ResumableSessionStatus> {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Length": "0",
      "Content-Range": `bytes */${totalSize}`,
    },
  });

  if (response.status === 404 || response.status === 410) {
    return { offset: 0, expired: true };
  }

  if (response.status === 308) {
    return { offset: parseConfirmedOffset(response.headers.get("range")) ?? 0 };
  }

  if (!response.ok) {
    throw new Error(await resumableUploadError(response));
  }

  return {
    offset: totalSize,
    completedFile: await response.json() as drive_v3.Schema$File,
  };
}

function parseConfirmedOffset(rangeHeader: string | null) {
  if (!rangeHeader) return undefined;
  const match = rangeHeader.match(/bytes=0-(\d+)/i);
  if (!match) return undefined;
  return Number(match[1]) + 1;
}

async function downloadSourceRange(source: drive_v3.Drive, fileId: string, start: number, end: number) {
  const response = await source.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer", headers: { Range: `bytes=${start}-${end}` } },
  );
  return Buffer.from(response.data as ArrayBuffer);
}

async function resumableUploadError(response: Response) {
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 300);
  return `Google Drive resumable upload failed (${response.status})${detail ? `: ${detail}` : ""}`;
}
