import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";
import { User } from "@/models/user";

interface MigrationProgressRecord {
  userId: { toString(): string };
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  status?: string;
  copiedBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
}

interface UserIdRecord {
  _id: { toString(): string };
}

interface CurrentMigrationItemRecord {
  sourceName?: string;
  uploadedBytes?: number;
  size?: number;
}

interface FailedMigrationItemRecord {
  _id: { toString(): string };
  sourceName?: string;
  sourcePath?: string;
  errorMessage?: string;
  retryCount?: number;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  await connectDb();
  const { id } = await params;
  const user = await User.findOne({ email: session.user.email }).select("_id").lean<UserIdRecord>();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const migration = await Migration.findById(id).lean<MigrationProgressRecord>();
  if (!migration) return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  if (migration.userId.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  }

  const [current, failedItemRecords] = await Promise.all([
    MigrationItem.findOne({ migrationId: id, status: "copying" })
      .select("sourceName uploadedBytes size")
      .lean<CurrentMigrationItemRecord>(),
    MigrationItem.find({ migrationId: id, itemType: "file", status: "failed" })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("sourceName sourcePath errorMessage retryCount")
      .lean<FailedMigrationItemRecord[]>(),
  ]);

  const totalFiles = migration.totalFiles || 0;
  const completedFiles = migration.completedFiles || 0;
  const failedFiles = migration.failedFiles || 0;
  const processedFiles = completedFiles + failedFiles;
  const percentage = totalFiles ? Number(((processedFiles / totalFiles) * 100).toFixed(1)) : 0;
  const failedItems = failedItemRecords.map((item) => ({
    id: item._id.toString(),
    name: item.sourceName ?? "Untitled file",
    path: item.sourcePath ?? item.sourceName ?? "Untitled file",
    error: item.errorMessage,
    retryCount: item.retryCount ?? 0,
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
