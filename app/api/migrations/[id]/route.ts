import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await connectDb();
  const { id } = await params;
  const migration = await Migration.findById(id).lean();
  if (!migration) return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  const current = await MigrationItem.findOne({ migrationId: id, status: "copying" }).lean();
  const totalFiles = migration.totalFiles || 0;
  const percentage = totalFiles ? Number((((migration.completedFiles || 0) / totalFiles) * 100).toFixed(1)) : 0;
  return NextResponse.json({
    totalFiles,
    completedFiles: migration.completedFiles || 0,
    failedFiles: migration.failedFiles || 0,
    currentFile: current?.sourceName,
    percentage,
    status: migration.status,
    copiedBytes: migration.copiedBytes,
    totalBytes: migration.totalBytes,
  });
}
