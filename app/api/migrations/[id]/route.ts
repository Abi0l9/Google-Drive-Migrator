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
}

interface UserIdRecord {
  _id: { toString(): string };
}

interface CurrentMigrationItemRecord {
  sourceName?: string;
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

  const current = await MigrationItem.findOne({ migrationId: id, status: "copying" }).lean<CurrentMigrationItemRecord>();
  const totalFiles = migration.totalFiles || 0;
  const completedFiles = migration.completedFiles || 0;
  const failedFiles = migration.failedFiles || 0;
  const processedFiles = completedFiles + failedFiles;
  const percentage = totalFiles ? Number(((processedFiles / totalFiles) * 100).toFixed(1)) : 0;

  return NextResponse.json({
    totalFiles,
    completedFiles,
    failedFiles,
    currentFile: current?.sourceName,
    percentage,
    status: migration.status,
    copiedBytes: migration.copiedBytes,
    totalBytes: migration.totalBytes,
  });
}
