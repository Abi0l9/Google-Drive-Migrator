import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import mongoose from "mongoose";
import { drive_v3, google } from "googleapis";
import { encryptToken } from "../lib/crypto";
import { connectDb } from "../lib/db";
import {
  closeMigrationQueueResources,
  getScanQueue,
} from "../lib/queue/migrations";
import { registerMigrationWorkers } from "../lib/workers/migration-workers";
import { Migration } from "../models/migration";
import { MigrationItem } from "../models/migration-item";
import { User } from "../models/user";

const integrationEnabled = process.env.GDM_INTEGRATION_TESTS === "1";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

interface DestinationRecord {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  body?: Buffer;
}

test("queued worker migrates a nested public folder into Drive", {
  skip: !integrationEnabled,
  timeout: 25_000,
}, async () => {
  const sourceFiles = new Map([
    ["source-file-a", { name: "hello.txt", mimeType: "text/plain", body: Buffer.from("hello world") }],
    ["source-file-b", { name: "inside.txt", mimeType: "text/plain", body: Buffer.from("nested data") }],
  ]);
  const destinationRecords: DestinationRecord[] = [];
  let destinationSequence = 0;

  const sourceDrive = fakeSourceDrive(sourceFiles);
  const destinationDrive = fakeDestinationDrive(destinationRecords, () => {
    destinationSequence += 1;
    return `destination-${destinationSequence}`;
  });

  const mutableGoogle = google as typeof google & { drive: typeof google.drive };
  const originalDriveFactory = mutableGoogle.drive;
  mutableGoogle.drive = ((options: unknown) => {
    const auth = isRecord(options) ? options.auth : undefined;
    return typeof auth === "string" ? sourceDrive : destinationDrive;
  }) as unknown as typeof google.drive;

  const workers: Array<{ close(): Promise<void> }> = [];

  try {
    await connectDb();
    await mongoose.connection.db?.dropDatabase();

    const accessToken = encryptToken("integration-access-token");
    const refreshToken = encryptToken("integration-refresh-token");
    assert(accessToken && refreshToken);

    const user = await User.create({
      name: "Integration User",
      email: "integration@example.com",
      googleId: "integration-google-id",
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const migration = await Migration.create({
      userId: user._id,
      sourceFolderId: "source-root",
      sourceFolderUrl: "https://drive.google.com/drive/folders/source-root",
      sourceFolderName: "Public Example",
      destinationFolderId: "root",
      destinationFolderName: "My Drive",
      status: "pending",
    });

    workers.push(...registerMigrationWorkers());
    await getScanQueue().add("scan-folder", { migrationId: migration._id.toString() });

    const completed = await waitForMigration(migration._id.toString());
    assert.equal(completed.status, "completed", completed.errorMessage ?? "migration should complete");
    assert.equal(completed.totalFiles, 2);
    assert.equal(completed.completedFiles, 2);
    assert.equal(completed.failedFiles, 0);
    assert.equal(completed.totalBytes, 22);
    assert.equal(completed.copiedBytes, 22);
    assert.ok(completed.destinationRootFolderId);

    const items = await MigrationItem.find({ migrationId: migration._id }).sort({ sourcePath: 1 }).lean();
    assert.equal(items.length, 3);
    assert.equal(items.filter((item) => item.itemType === "folder").length, 1);
    assert.equal(items.filter((item) => item.itemType === "file" && item.status === "completed").length, 2);

    const createdFolders = destinationRecords.filter((record) => record.mimeType === FOLDER_MIME_TYPE);
    assert.deepEqual(createdFolders.map((record) => record.name).sort(), ["Nested", "Public Example"]);

    const uploadedBodies = destinationRecords
      .filter((record) => record.body)
      .map((record) => record.body!.toString("utf8"));
    assert.deepEqual(uploadedBodies.sort(), ["hello world", "nested data"]);

    const rootFolder = createdFolders.find((record) => record.name === "Public Example");
    const nestedFolder = createdFolders.find((record) => record.name === "Nested");
    assert.deepEqual(rootFolder?.parents, ["root"]);
    assert.deepEqual(nestedFolder?.parents, [rootFolder?.id]);
  } finally {
    mutableGoogle.drive = originalDriveFactory;
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeMigrationQueueResources();
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
});

function fakeSourceDrive(sourceFiles: Map<string, { name: string; mimeType: string; body: Buffer }>) {
  return {
    files: {
      list: async (params: { q?: string }) => {
        const query = params.q ?? "";
        if (query.includes("'source-root' in parents")) {
          return {
            data: {
              files: [
                { id: "source-file-a", name: "hello.txt", mimeType: "text/plain", size: "11" },
                { id: "source-nested", name: "Nested", mimeType: FOLDER_MIME_TYPE, size: "0" },
              ],
            },
          };
        }

        if (query.includes("'source-nested' in parents")) {
          return {
            data: {
              files: [
                { id: "source-file-b", name: "inside.txt", mimeType: "text/plain", size: "11" },
              ],
            },
          };
        }

        return { data: { files: [] } };
      },
      get: async (params: { fileId?: string; alt?: string }) => {
        const source = params.fileId ? sourceFiles.get(params.fileId) : undefined;
        if (!source || !params.fileId) throw new Error("Fake source file not found");

        if (params.alt === "media") {
          return { data: Readable.from(source.body) };
        }

        return {
          data: {
            id: params.fileId,
            name: source.name,
            mimeType: source.mimeType,
            size: String(source.body.byteLength),
          },
        };
      },
      export: async () => {
        throw new Error("Workspace export is not expected in this integration fixture");
      },
    },
  } as unknown as drive_v3.Drive;
}

function fakeDestinationDrive(destinationRecords: DestinationRecord[], nextDestinationId: () => string) {
  return {
    files: {
      list: async () => ({ data: { files: [] } }),
      create: async (params: {
        requestBody?: {
          name?: string;
          mimeType?: string;
          parents?: string[];
        };
        media?: { body?: unknown };
      }) => {
        const id = nextDestinationId();
        const body = await readableBody(params.media?.body);
        const record: DestinationRecord = {
          id,
          name: params.requestBody?.name ?? "Untitled",
          mimeType: params.requestBody?.mimeType,
          parents: params.requestBody?.parents,
          ...(body ? { body } : {}),
        };
        destinationRecords.push(record);
        return {
          data: {
            id,
            name: record.name,
            size: body ? String(body.byteLength) : undefined,
          },
        };
      },
    },
  } as unknown as drive_v3.Drive;
}

async function readableBody(value: unknown) {
  if (!(value instanceof Readable)) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of value) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function waitForMigration(migrationId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const migration = await Migration.findById(migrationId).lean<{
      status: string;
      totalFiles: number;
      completedFiles: number;
      failedFiles: number;
      totalBytes: number;
      copiedBytes: number;
      destinationRootFolderId?: string;
      errorMessage?: string;
    }>();

    if (!migration) throw new Error("Integration migration disappeared");
    if (["completed", "failed", "cancelled"].includes(migration.status)) return migration;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for integration migration to finish");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
