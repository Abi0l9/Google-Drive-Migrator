import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { getScanQueue } from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

const CreateMigration = z.object({
  sourceFolderId: z.string().min(1),
  sourceFolderUrl: z.string().url(),
  sourceFolderName: z.string().min(1),
  destinationFolderId: z.string().min(1),
  destinationFolderName: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const parsed = CreateMigration.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid migration request" }, { status: 400 });
  await connectDb();
  const user = await User.findOne({ email: session.user.email });
  if (!user?.accessToken) return NextResponse.json({ error: "Google Drive authorization required" }, { status: 403 });
  const migration = await Migration.create({ ...parsed.data, userId: user._id, status: "pending" });
  try {
    await getScanQueue().add("scan-folder", { migrationId: migration._id.toString() });
  } catch (error) {
    migration.status = "failed";
    migration.errorMessage = error instanceof Error ? error.message : "Redis queue unavailable";
    await migration.save();
    return NextResponse.json({ error: "Redis is not available. Start Redis before creating migrations." }, { status: 503 });
  }
  return NextResponse.json({ migrationId: migration._id.toString(), status: migration.status }, { status: 201 });
}
