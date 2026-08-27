import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import {
  getCurrentCopyingItem,
  getMigrationForUser,
  getUserByEmail,
  listFailedFileItems,
} from "@/lib/cloudflare/d1";
import { reconcileMigrationCounters } from "@/lib/cloudflare/d1-jobs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const cloudflare = getGdmCloudflareEnv();
  const { id } = await params;
  const user = await getUserByEmail(cloudflare.DB, session.user.email);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const quota = await cloudflare.API_RATE_LIMITER.limit({ key: `migration-progress:${user.id}:${id}` });
  if (!quota.success) {
    return NextResponse.json(
      { error: "Too many progress requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let migration = await getMigrationForUser(cloudflare.DB, id, user.id);
  if (!migration) return NextResponse.json({ error: "Migration not found" }, { status: 404 });

  migration = (await reconcileMigrationCounters(cloudflare.DB, id)) ?? migration;
  const [current, failedItemRecords] = await Promise.all([
    getCurrentCopyingItem(cloudflare.DB, id),
    listFailedFileItems(cloudflare.DB, id, 10),
  ]);

  const totalFiles = migration.totalFiles || 0;
  const completedFiles = migration.completedFiles || 0;
  const failedFiles = migration.failedFiles || 0;
  const processedFiles = completedFiles + failedFiles;
  const percentage = totalFiles ? Number(((processedFiles / totalFiles) * 100).toFixed(1)) : 0;
  const failedItems = failedItemRecords.map((item) => ({
    id: item.id,
    name: item.sourceName || "Untitled file",
    path: item.sourcePath || item.sourceName || "Untitled file",
    error: item.errorMessage,
    retryCount: item.retryCount || 0,
  }));

  return NextResponse.json({
    totalFiles,
    completedFiles,
    failedFiles,
    currentFile: current?.sourceName,
    currentFileUploadedBytes: current?.uploadedBytes,
    currentFileTotalBytes: current?.size,
    percentage,
    status: migration.status,
    copiedBytes: migration.copiedBytes,
    totalBytes: migration.totalBytes,
    errorMessage: migration.errorMessage,
    failedItems,
  });
}
