import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  GOOGLE_REAUTH_REQUIRED,
  GoogleReauthorizationRequiredError,
  isGoogleReauthorizationRequiredError,
} from "@/lib/google/auth-errors";
import { extractDriveFolderId, userDrive, validateDestinationFolder } from "@/lib/google/drive";
import { getFreshGoogleAccessToken } from "@/lib/google/user-auth";
import { canCreateActiveMigration } from "@/lib/migration/quota";
import {
  getScanQueue,
  MigrationCreationLockBusyError,
  withMigrationCreationLock,
} from "@/lib/queue/migrations";
import { rateLimit } from "@/lib/rate-limit";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

const CreateMigration = z.object({
  sourceFolderId: z.string().min(1),
  sourceFolderUrl: z.string().url(),
  sourceFolderName: z.string().min(1),
  destinationFolderRef: z.string().min(1).max(2048),
});

const activeStatuses = ["pending", "scanning", "running", "paused"];

class ActiveMigrationQuotaError extends Error {
  constructor(public activeCount: number, public maxActive: number) {
    super("Active migration quota reached");
    this.name = "ActiveMigrationQuotaError";
  }
}

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
  if (!user?.accessToken) {
    const reconnect = new GoogleReauthorizationRequiredError();
    return NextResponse.json(
      { error: reconnect.message, code: GOOGLE_REAUTH_REQUIRED },
      { status: 403 },
    );
  }

  const quota = await rateLimit(`migration-create:${user._id.toString()}`, 5, 60_000);
  if (!quota.allowed) {
    return NextResponse.json({ error: "Too many migration requests. Try again in a minute." }, { status: 429 });
  }

  let destination: { id: string; name: string };
  try {
    const accessToken = await getFreshGoogleAccessToken(user);
    destination = await validateDestinationFolder(userDrive(accessToken), parsed.data.destinationFolderRef);
  } catch (error) {
    if (isGoogleReauthorizationRequiredError(error)) {
      return NextResponse.json(
        { error: error.message, code: GOOGLE_REAUTH_REQUIRED },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to access destination folder" },
      { status: 403 },
    );
  }

  const existingMigration = await findExistingActiveMigration(user._id, parsed.data.sourceFolderId, destination.id);
  if (existingMigration) {
    return NextResponse.json({
      migrationId: existingMigration._id.toString(),
      status: existingMigration.status,
      reused: true,
    });
  }

  let creation: { migration: InstanceType<typeof Migration>; reused: boolean };
  try {
    creation = await withMigrationCreationLock(user._id.toString(), async () => {
      const lockedExisting = await findExistingActiveMigration(user._id, parsed.data.sourceFolderId, destination.id);
      if (lockedExisting) return { migration: lockedExisting, reused: true };

      const activeMigrationCount = await Migration.countDocuments({
        userId: user._id,
        status: { $in: activeStatuses },
      });

      if (!canCreateActiveMigration(activeMigrationCount, env.maxActiveMigrationsPerUser)) {
        throw new ActiveMigrationQuotaError(activeMigrationCount, env.maxActiveMigrationsPerUser);
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

      return { migration, reused: false };
    });
  } catch (error) {
    if (error instanceof ActiveMigrationQuotaError) {
      return NextResponse.json(
        {
          error: `You already have ${error.activeCount} active migrations. Finish, cancel, or wait for one to complete before starting another.`,
          maxActiveMigrations: error.maxActive,
        },
        { status: 429 },
      );
    }

    if (error instanceof MigrationCreationLockBusyError) {
      return NextResponse.json(
        { error: "Another migration request is already being processed. Try again shortly." },
        { status: 409, headers: { "Retry-After": "1" } },
      );
    }

    return NextResponse.json({ error: "Migration coordination is unavailable. Try again shortly." }, { status: 503 });
  }

  if (creation.reused) {
    return NextResponse.json({
      migrationId: creation.migration._id.toString(),
      status: creation.migration.status,
      reused: true,
    });
  }

  const migration = creation.migration;
  try {
    await getScanQueue().add("scan-folder", { migrationId: migration._id.toString() });
  } catch (error) {
    migration.status = "failed";
    migration.errorMessage = error instanceof Error ? error.message : "Redis queue unavailable";
    await migration.save();
    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ migrationId: migration._id.toString(), status: migration.status, reused: false }, { status: 201 });
}

function findExistingActiveMigration(userId: unknown, sourceFolderId: string, destinationFolderId: string) {
  return Migration.findOne({
    userId,
    sourceFolderId,
    destinationFolderId,
    status: { $in: activeStatuses },
  }).select("_id status");
}
