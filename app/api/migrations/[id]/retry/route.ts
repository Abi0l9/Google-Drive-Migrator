import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import {
  GOOGLE_REAUTH_REQUIRED,
  isGoogleReauthorizationRequiredError,
} from "@/lib/google/auth-errors";
import { retryMigrationForUser } from "@/lib/migration/controls";
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

  try {
    const result = await retryMigrationForUser(user._id.toString(), id);
    if (result.outcome === "not_found") {
      return NextResponse.json({ error: "Migration not found" }, { status: 404 });
    }
    if (result.outcome === "conflict") {
      return NextResponse.json({ error: `A ${result.status} migration cannot be retried` }, { status: 409 });
    }
    if (result.outcome === "queue_unavailable") {
      return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
    }

    return NextResponse.json({ retried: result.retried ?? 0, status: result.status });
  } catch (error) {
    if (isGoogleReauthorizationRequiredError(error)) {
      return NextResponse.json(
        { error: error.message, code: GOOGLE_REAUTH_REQUIRED },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: "Unable to verify Google Drive authorization. Try again shortly." },
      { status: 503 },
    );
  }
}
