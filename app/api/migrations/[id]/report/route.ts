import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getMigrationForUser, getUserByEmail } from "@/lib/cloudflare/d1";
import { reconcileMigrationCounters } from "@/lib/cloudflare/d1-jobs";
import { buildMigrationCsv, safeReportFileName } from "@/lib/migration/report";

interface ReportItem {
  id: string;
  sourceName: string;
  sourcePath: string;
  sourceMimeType: string;
  destinationFileId: string | null;
  destinationFolderId: string | null;
  itemType: "file" | "folder";
  size: number;
  status: string;
  retryCount: number;
  errorMessage: string | null;
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
const PAGE_SIZE = 500;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const cloudflare = getGdmCloudflareEnv();
  const { id } = await params;
  const user = await getUserByEmail(cloudflare.DB, session.user.email);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let migration = await getMigrationForUser(cloudflare.DB, id, user.id);
  if (!migration) return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  if (!terminalStatuses.has(migration.status)) {
    return NextResponse.json({ error: "Reports are available after a migration finishes" }, { status: 409 });
  }
  migration = (await reconcileMigrationCounters(cloudflare.DB, id)) ?? migration;

  const items = await readAllItems(cloudflare.DB, id);
  const reportItems = items.map((item) => ({
    id: item.id,
    type: item.itemType,
    name: item.sourceName,
    path: item.sourcePath,
    mimeType: item.sourceMimeType,
    size: item.size,
    status: item.status,
    destinationFileId: item.destinationFileId ?? undefined,
    destinationFolderId: item.destinationFolderId ?? undefined,
    retryCount: item.retryCount,
    error: item.errorMessage ?? undefined,
  }));

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const baseName = safeReportFileName(migration.sourceFolderName || "migration");

  if (format === "json") {
    return new Response(JSON.stringify({
      generatedAt: new Date().toISOString(),
      migration: {
        id: migration.id,
        sourceFolderName: migration.sourceFolderName,
        sourceFolderUrl: migration.sourceFolderUrl,
        destinationFolderName: migration.destinationFolderName,
        destinationFolderId: migration.destinationFolderId,
        destinationRootFolderId: migration.destinationRootFolderId,
        status: migration.status,
        totalFiles: migration.totalFiles,
        completedFiles: migration.completedFiles,
        failedFiles: migration.failedFiles,
        totalBytes: migration.totalBytes,
        copiedBytes: migration.copiedBytes,
        startedAt: migration.startedAt,
        completedAt: migration.completedAt,
        createdAt: migration.createdAt,
      },
      items: reportItems,
    }, null, 2), { headers: downloadHeaders(`${baseName}-migration-report.json`, "application/json; charset=utf-8") });
  }

  return new Response(`\uFEFF${buildMigrationCsv(reportItems)}\n`, {
    headers: downloadHeaders(`${baseName}-migration-report.csv`, "text/csv; charset=utf-8"),
  });
}

async function readAllItems(db: D1Database, migrationId: string) {
  const output: ReportItem[] = [];
  let offset = 0;
  while (true) {
    const page = await db.prepare(`
      SELECT id, source_name AS sourceName, source_path AS sourcePath,
        source_mime_type AS sourceMimeType, destination_file_id AS destinationFileId,
        destination_folder_id AS destinationFolderId, item_type AS itemType, size, status,
        retry_count AS retryCount, error_message AS errorMessage
      FROM migration_items
      WHERE migration_id = ?
      ORDER BY source_path ASC, id ASC
      LIMIT ? OFFSET ?
    `).bind(migrationId, PAGE_SIZE, offset).all<ReportItem>();
    output.push(...page.results);
    if (page.results.length < PAGE_SIZE) return output;
    offset += page.results.length;
  }
}

function downloadHeaders(fileName: string, contentType: string) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
}
