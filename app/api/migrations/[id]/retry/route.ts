import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { getReportQueue, getTransferQueue } from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";
import { User } from "@/models/user";

interface UserIdRecord {
  _id: { toString(): string };
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  await connectDb();
  const { id } = await params;
  const user = await User.findOne({ email: session.user.email }).select("_id").lean<UserIdRecord>();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const migration = await Migration.findById(id);
  if (!migration || migration.userId.toString() !== user._id.toString()) {
    return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  }

  const failedItems = await MigrationItem.find({
    migrationId: migration._id,
    itemType: "file",
    status: "failed",
  }).select("_id");

  if (!failedItems.length) {
    return NextResponse.json({ retried: 0, status: migration.status });
  }

  const failedIds = failedItems.map((item) => item._id);

  await MigrationItem.updateMany(
    { _id: { $in: failedIds } },
    { $set: { status: "pending", retryCount: 0 }, $unset: { errorMessage: "" } },
  );

  migration.status = "running";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  try {
    await getTransferQueue().addBulk(
      failedItems.map((item) => ({
        name: "retry-transfer-file",
        data: { migrationId: migration._id.toString(), itemId: item._id.toString() },
      })),
    );
    await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
  } catch (error) {
    await MigrationItem.updateMany(
      { _id: { $in: failedIds }, status: "pending" },
      { $set: { status: "failed", errorMessage: "Retry queue unavailable" } },
    );
    migration.status = "failed";
    migration.errorMessage = error instanceof Error ? error.message : "Retry queue unavailable";
    migration.completedAt = new Date();
    await migration.save();

    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ retried: failedItems.length, status: migration.status });
}
