import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface UserIdRecord {
  _id: { toString(): string };
}

const pausableStatuses = new Set(["pending", "scanning", "running"]);

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

  if (migration.status === "paused") {
    return NextResponse.json({ status: migration.status });
  }

  if (!pausableStatuses.has(migration.status)) {
    return NextResponse.json({ error: `A ${migration.status} migration cannot be paused` }, { status: 409 });
  }

  migration.status = "paused";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  return NextResponse.json({ status: migration.status });
}
