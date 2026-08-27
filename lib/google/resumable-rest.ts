import {
  type DriveFile,
  type MigrationMarker,
  GoogleDriveHttpError,
  destinationFileName,
  getPublicFileStream,
} from "@/lib/google/drive-rest";

export const WORKER_RESUMABLE_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const WORKER_RESUMABLE_CHUNK_SIZE_BYTES = 32 * 1024 * 1024;
export const WORKER_MAX_CHUNKS_PER_JOB = 12;

export interface ResumableRestOptions {
  apiKey: string;
  accessToken: string;
  file: DriveFile;
  parentId: string;
  marker: MigrationMarker;
  sessionUrl?: string;
  maxChunks?: number;
  onSession?: (sessionUrl: string) => Promise<void> | void;
  onProgress?: (uploadedBytes: number) => Promise<void> | void;
  shouldContinue?: () => Promise<boolean> | boolean;
}

export type ResumableRestResult =
  | { completed: true; file: DriveFile; uploadedBytes: number; sessionUrl: string }
  | { completed: false; uploadedBytes: number; sessionUrl: string };

export class ResumableUploadInterruptedError extends Error {
  constructor(message = "Migration transfer paused or cancelled") {
    super(message);
    this.name = "ResumableUploadInterruptedError";
  }
}

export function shouldUseWorkerResumableUpload(file: DriveFile) {
  const size = Number(file.size ?? 0);
  return size > WORKER_RESUMABLE_UPLOAD_THRESHOLD_BYTES && !(file.mimeType ?? "").startsWith("application/vnd.google-apps.");
}

export async function continueResumableCopy(options: ResumableRestOptions): Promise<ResumableRestResult> {
  const totalSize = Number(options.file.size ?? 0);
  if (!options.file.id || !Number.isFinite(totalSize) || totalSize <= 0) {
    throw new Error("Resumable upload requires a downloadable file with a known size");
  }

  await assertCanContinue(options);
  let sessionUrl = options.sessionUrl;
  let offset = 0;

  if (sessionUrl) {
    const status = await queryResumableSession(sessionUrl, totalSize);
    if (status.completedFile) {
      return { completed: true, file: status.completedFile, uploadedBytes: totalSize, sessionUrl };
    }
    if (status.expired) {
      sessionUrl = undefined;
      await options.onProgress?.(0);
    } else {
      offset = status.offset;
      await options.onProgress?.(offset);
    }
  }

  if (!sessionUrl) {
    sessionUrl = await createResumableSession(
      options.accessToken,
      options.file,
      options.parentId,
      options.marker,
      totalSize,
    );
    await options.onSession?.(sessionUrl!);
  }

  const maxChunks = Math.min(20, Math.max(1, Math.floor(options.maxChunks ?? WORKER_MAX_CHUNKS_PER_JOB)));
  let chunksProcessed = 0;

  while (offset < totalSize && chunksProcessed < maxChunks) {
    await assertCanContinue(options);
    const end = Math.min(offset + WORKER_RESUMABLE_CHUNK_SIZE_BYTES, totalSize) - 1;
    const source = await getPublicFileStream(options.apiKey, options.file.id, `bytes=${offset}-${end}`);
    if (!source.body) throw new Error("Google Drive source download did not return a readable body");

    const expectedLength = end - offset + 1;
    const contentLength = Number(source.headers.get("content-length") ?? expectedLength);
    if (Number.isFinite(contentLength) && contentLength !== expectedLength) {
      throw new Error(`Source partial download returned ${contentLength} bytes; expected ${expectedLength}`);
    }

    const response: Response = await fetch(sessionUrl!, {
      method: "PUT",
      headers: {
        "Content-Length": String(expectedLength),
        "Content-Type": options.file.mimeType ?? "application/octet-stream",
        "Content-Range": `bytes ${offset}-${end}/${totalSize}`,
      },
      body: source.body,
    });

    const rotatedSessionUrl: string | null = response.headers.get("location");
    if (rotatedSessionUrl && rotatedSessionUrl !== sessionUrl) {
      sessionUrl = rotatedSessionUrl;
      await options.onSession?.(sessionUrl!);
    }

    if (response.status === 308) {
      const confirmedOffset = parseConfirmedOffset(response.headers.get("range"));
      const nextOffset = confirmedOffset ?? end + 1;
      if (nextOffset <= offset) throw new Error("Google Drive resumable upload did not advance");
      offset = Math.min(nextOffset, totalSize);
      chunksProcessed += 1;
      await options.onProgress?.(offset);
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      sessionUrl = await createResumableSession(
        options.accessToken,
        options.file,
        options.parentId,
        options.marker,
        totalSize,
      );
      offset = 0;
      chunksProcessed += 1;
      await options.onSession?.(sessionUrl!);
      await options.onProgress?.(0);
      continue;
    }

    if (!response.ok) throw await resumableHttpError(response);

    const uploaded = await response.json() as DriveFile;
    await options.onProgress?.(totalSize);
    return { completed: true, file: uploaded, uploadedBytes: totalSize, sessionUrl: sessionUrl! };
  }

  return { completed: false, uploadedBytes: offset, sessionUrl: sessionUrl! };
}

async function createResumableSession(
  accessToken: string,
  file: DriveFile,
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
      name: destinationFileName(file),
      parents: [parentId],
      appProperties: {
        gdmMigrationId: marker.migrationId,
        gdmSourceId: marker.sourceId,
      },
    }),
  });
  if (!response.ok) throw await resumableHttpError(response);
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("Google Drive did not return a resumable upload session");
  return sessionUrl;
}

async function queryResumableSession(sessionUrl: string, totalSize: number) {
  const response: Response = await fetch(sessionUrl!, {
    method: "PUT",
    headers: {
      "Content-Length": "0",
      "Content-Range": `bytes */${totalSize}`,
    },
  });
  if (response.status === 404 || response.status === 410) return { offset: 0, expired: true };
  if (response.status === 308) return { offset: parseConfirmedOffset(response.headers.get("range")) ?? 0 };
  if (!response.ok) throw await resumableHttpError(response);
  return { offset: totalSize, completedFile: await response.json() as DriveFile };
}

export function parseConfirmedOffset(rangeHeader: string | null) {
  if (!rangeHeader) return undefined;
  const match = rangeHeader.match(/bytes=0-(\d+)/i);
  if (!match) return undefined;
  return Number(match[1]) + 1;
}

async function assertCanContinue(options: ResumableRestOptions) {
  if (!options.shouldContinue) return;
  if (!(await options.shouldContinue())) throw new ResumableUploadInterruptedError();
}

async function resumableHttpError(response: Response) {
  let message = `Google Drive resumable upload failed (${response.status})`;
  let reason: string | undefined;
  try {
    const payload = await response.clone().json() as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    message = payload.error?.message || message;
    reason = payload.error?.errors?.[0]?.reason;
  } catch {
    // Status is still sufficient for retry classification.
  }
  return new GoogleDriveHttpError(message, response.status, reason, response.headers.get("retry-after"));
}
