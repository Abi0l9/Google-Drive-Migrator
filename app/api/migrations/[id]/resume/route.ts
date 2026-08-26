import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { getRetryQueue, getScanQueue } from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface UserIdRecord {
  _id: { toString(): string };
}

const alreadyActiveStatuses = new Set(["pending", "scanning", "running"]);

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

  if (alreadyActiveStatuses.has(migration.status)) {
    return NextResponse.json({ status: migration.status });
  }

  if (migration.status !== "paused") {
    return NextResponse.json({ error: `A ${migration.status} migration cannot be resumed` }, { status: 409 });
  }

  const scanCompleted = Boolean(migration.scanCompleted);
  migration.status = scanCompleted ? "running" : "pending";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  try {
    if (scanCompleted) {
      await getRetryQueue().add(
        "resume-migration",
        { migrationId: migration._id.toString() },
        { delay: 1500 },
      );
    } else {
      await getScanQueue().add("resume-scan", { migrationId: migration._id.toString() });
    }
  } catch (error) {
    migration.status = "paused";
    migration.errorMessage = error instanceof Error ? error.message : "Migration queue unavailable";
    await migration.save();
    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ status: migration.status, scanCompleted });
}
