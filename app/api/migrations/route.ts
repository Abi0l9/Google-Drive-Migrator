import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { extractDriveFolderId, userDrive, validateDestinationFolder } from "@/lib/google/drive";
import { getFreshGoogleAccessToken } from "@/lib/google/user-auth";
import { getScanQueue } from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

const CreateMigration = z.object({
  sourceFolderId: z.string().min(1),
  sourceFolderUrl: z.string().url(),
  sourceFolderName: z.string().min(1),
  destinationFolderRef: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const parsed = CreateMigration.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid migration request" }, { status: 400 });

  let sourceFolderId: string;
  try {
    sourceFolderId = extractDriveFolderId(parsed.data.sourceFolderUrl);
  } catch {
    return NextResponse.json({ error: "Invalid Google Drive Folder URL" }, { status: 400 });
  }
  if (sourceFolderId !== parsed.data.sourceFolderId) {
    return NextResponse.json({ error: "Source folder does not match the analyzed folder" }, { status: 400 });
  }

  await connectDb();
  const user = await User.findOne({ email: session.user.email });
  if (!user?.accessToken) return NextResponse.json({ error: "Google Drive authorization required" }, { status: 403 });

  let destination: { id: string; name: string };
  try {
    const accessToken = await getFreshGoogleAccessToken(user);
    destination = await validateDestinationFolder(userDrive(accessToken), parsed.data.destinationFolderRef);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to access destination folder" },
      { status: 403 },
    );
  }

  const migration = await Migration.create({
    sourceFolderId: parsed.data.sourceFolderId,
    sourceFolderUrl: parsed.data.sourceFolderUrl,
    sourceFolderName: parsed.data.sourceFolderName,
    destinationFolderId: destination.id,
    destinationFolderName: destination.name,
    userId: user._id,
    status: "pending",
  });

  try {
    await getScanQueue().add("scan-folder", { migrationId: migration._id.toString() });
  } catch (error) {
    migration.status = "failed";
    migration.errorMessage = error instanceof Error ? error.message : "Redis queue unavailable";
    await migration.save();
    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ migrationId: migration._id.toString(), status: migration.status }, { status: 201 });
}
