import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { resumeMigrationForUser } from "@/lib/migration/controls";
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

  const result = await resumeMigrationForUser(user._id.toString(), id);
  if (result.outcome === "not_found") {
    return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  }
  if (result.outcome === "conflict") {
    return NextResponse.json({ error: `A ${result.status} migration cannot be resumed` }, { status: 409 });
  }
  if (result.outcome === "queue_unavailable") {
    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ status: result.status, scanCompleted: result.scanCompleted });
}
