import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import mongoose from "mongoose";
import { google } from "googleapis";
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

  const server = createServer(async (request, response) => {
    try {
      await handleFakeDriveRequest(request, response, sourceFiles, destinationRecords, () => {
        destinationSequence += 1;
        return `destination-${destinationSequence}`;
      });
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "fake Drive failure" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const fakeDriveRoot = `http://127.0.0.1:${address.port}/`;
  google.options({ rootUrl: fakeDriveRoot });

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
    assert.equal(uploadedBodies.length, 2);
    assert.ok(uploadedBodies.some((body) => body.includes("hello world")));
    assert.ok(uploadedBodies.some((body) => body.includes("nested data")));
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeMigrationQueueResources();
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
    google.options({ rootUrl: "https://www.googleapis.com/" });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function handleFakeDriveRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sourceFiles: Map<string, { name: string; mimeType: string; body: Buffer }>,
  destinationRecords: DestinationRecord[],
  nextDestinationId: () => string,
) {
  const url = new URL(request.url ?? "/", "http://fake-drive.local");

  if (request.method === "GET" && url.pathname === "/drive/v3/files") {
    const query = url.searchParams.get("q") ?? "";
    if (query.includes("appProperties has")) {
      return json(response, { files: [] });
    }

    if (query.includes("'source-root' in parents")) {
      return json(response, {
        files: [
          { id: "source-file-a", name: "hello.txt", mimeType: "text/plain", size: "11" },
          { id: "source-nested", name: "Nested", mimeType: FOLDER_MIME_TYPE, size: "0" },
        ],
      });
    }

    if (query.includes("'source-nested' in parents")) {
      return json(response, {
        files: [
          { id: "source-file-b", name: "inside.txt", mimeType: "text/plain", size: "11" },
        ],
      });
    }

    return json(response, { files: [] });
  }

  if (request.method === "GET" && url.pathname.startsWith("/drive/v3/files/")) {
    const fileId = decodeURIComponent(url.pathname.slice("/drive/v3/files/".length));
    const source = sourceFiles.get(fileId);
    if (!source) return json(response, { error: { message: "Not found" } }, 404);

    if (url.searchParams.get("alt") === "media") {
      response.statusCode = 200;
      response.setHeader("Content-Type", source.mimeType);
      response.end(source.body);
      return;
    }

    return json(response, {
      id: fileId,
      name: source.name,
      mimeType: source.mimeType,
      size: String(source.body.byteLength),
    });
  }

  if (request.method === "POST" && url.pathname === "/drive/v3/files") {
    const body = await readBody(request);
    const metadata = JSON.parse(body.toString("utf8")) as { name?: string; mimeType?: string };
    const id = nextDestinationId();
    destinationRecords.push({ id, name: metadata.name ?? "Untitled", mimeType: metadata.mimeType });
    return json(response, { id, name: metadata.name ?? "Untitled" });
  }

  if (request.method === "POST" && url.pathname === "/upload/drive/v3/files") {
    const body = await readBody(request);
    const metadata = multipartMetadata(body);
    const id = nextDestinationId();
    destinationRecords.push({ id, name: metadata.name ?? "Uploaded file", body });
    return json(response, { id, name: metadata.name ?? "Uploaded file", size: String(body.byteLength) });
  }

  return json(response, { error: { message: `Unhandled fake Drive request: ${request.method} ${url.pathname}` } }, 404);
}

function multipartMetadata(body: Buffer) {
  const text = body.toString("utf8");
  const match = text.match(/\{\s*"name"[\s\S]*?\}\r?\n--/);
  if (!match) return {} as { name?: string };
  const jsonText = match[0].replace(/\r?\n--$/, "");
  try {
    return JSON.parse(jsonText) as { name?: string };
  } catch {
    return {} as { name?: string };
  }
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, payload: unknown, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
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
