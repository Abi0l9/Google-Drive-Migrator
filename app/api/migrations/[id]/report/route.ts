import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";
import { User } from "@/models/user";

interface UserIdRecord {
  _id: { toString(): string };
}

interface ReportMigrationRecord {
  _id: { toString(): string };
  userId: { toString(): string };
  sourceFolderName: string;
  sourceFolderUrl: string;
  destinationFolderName: string;
  destinationFolderId: string;
  destinationRootFolderId?: string;
  status: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  totalBytes?: number;
  copiedBytes?: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
}

interface ReportItemRecord {
  _id: { toString(): string };
  sourceName: string;
  sourcePath: string;
  sourceMimeType: string;
  destinationFileId?: string;
  destinationFolderId?: string;
  itemType: "file" | "folder";
  size?: number;
  status: string;
  retryCount?: number;
  errorMessage?: string;
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  await connectDb();
  const { id } = await params;
  const user = await User.findOne({ email: session.user.email }).select("_id").lean<UserIdRecord>();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const migration = await Migration.findById(id).lean<ReportMigrationRecord>();
  if (!migration || migration.userId.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  }

  if (!terminalStatuses.has(migration.status)) {
    return NextResponse.json({ error: "Reports are available after a migration finishes" }, { status: 409 });
  }

  const items = await MigrationItem.find({ migrationId: id })
    .sort({ sourcePath: 1 })
    .lean<ReportItemRecord[]>();

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const baseName = safeFileName(migration.sourceFolderName || "migration");

  if (format === "json") {
    return new Response(JSON.stringify({
      generatedAt: new Date().toISOString(),
      migration: {
        id: migration._id.toString(),
        sourceFolderName: migration.sourceFolderName,
        sourceFolderUrl: migration.sourceFolderUrl,
        destinationFolderName: migration.destinationFolderName,
        destinationFolderId: migration.destinationFolderId,
        destinationRootFolderId: migration.destinationRootFolderId,
        status: migration.status,
        totalFiles: migration.totalFiles ?? 0,
        completedFiles: migration.completedFiles ?? 0,
        failedFiles: migration.failedFiles ?? 0,
        totalBytes: migration.totalBytes ?? 0,
        copiedBytes: migration.copiedBytes ?? 0,
        startedAt: migration.startedAt,
        completedAt: migration.completedAt,
        createdAt: migration.createdAt,
      },
      items: items.map((item) => ({
        id: item._id.toString(),
        type: item.itemType,
        name: item.sourceName,
        path: item.sourcePath,
        mimeType: item.sourceMimeType,
        size: item.size ?? 0,
        status: item.status,
        destinationFileId: item.destinationFileId,
        destinationFolderId: item.destinationFolderId,
        retryCount: item.retryCount ?? 0,
        error: item.errorMessage,
      })),
    }, null, 2), {
      headers: downloadHeaders(`${baseName}-migration-report.json`, "application/json; charset=utf-8"),
    });
  }

  const header = [
    "type",
    "name",
    "path",
    "mime_type",
    "size_bytes",
    "status",
    "destination_file_id",
    "destination_folder_id",
    "retry_count",
    "error",
  ];
  const rows = items.map((item) => [
    item.itemType,
    item.sourceName,
    item.sourcePath,
    item.sourceMimeType,
    item.size ?? 0,
    item.status,
    item.destinationFileId ?? "",
    item.destinationFolderId ?? "",
    item.retryCount ?? 0,
    item.errorMessage ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");

  return new Response(`\uFEFF${csv}\n`, {
    headers: downloadHeaders(`${baseName}-migration-report.csv`, "text/csv; charset=utf-8"),
  });
}

function downloadHeaders(fileName: string, contentType: string) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || "migration";
}

function csvValue(value: string | number) {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
