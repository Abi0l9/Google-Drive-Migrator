import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  ActiveMigrationQuotaError,
  createOrReuseMigration,
  getUserByEmail,
  setMigrationStatus,
} from "@/lib/cloudflare/d1";
import { FreeTierCapacityError, nextUtcReset } from "@/lib/cloudflare/free-tier";
import { publishMigrationJob } from "@/lib/cloudflare/queue";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { saveManualDedupSelection } from "@/lib/cloudflare/manual-dedup";
import {
  extractDriveFolderId,
  validateDestinationFolder,
} from "@/lib/google/drive-rest";
import { getFreshGoogleAccessTokenD1 } from "@/lib/google/user-auth-d1";
import { getAuthorizedDestinationItem } from "@/lib/google/selected-destination";
import { normalizeActiveMigrationLimit } from "@/lib/migration/quota";

const CreateMigration = z.object({
  sourceFolderId: z.string().min(1),
  sourceFolderUrl: z.string().url(),
  sourceFolderName: z.string().min(1),
  destinationFolderRef: z.string().min(1).max(2048),
  mergeIntoDestination: z.boolean().optional().default(false),
  existingDestinationItemIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).max(25).optional().default([]),
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

  const cloudflare = getGdmCloudflareEnv();
  const user = await getUserByEmail(cloudflare.DB, session.user.email);
  if (!user?.accessToken) return NextResponse.json({ error: "Google Drive authorization required" }, { status: 403 });

  const rate = await cloudflare.CREATE_RATE_LIMITER.limit({ key: `migration-create:${user.id}` });
  if (!rate.success) {
    return NextResponse.json({ error: "Too many migration requests. Try again in a minute." }, { status: 429 });
  }

  let accessToken: string;
  let destination: { id: string; name: string };
  try {
    accessToken = await getFreshGoogleAccessTokenD1(cloudflare, user);
    destination = await validateDestinationFolder(accessToken, parsed.data.destinationFolderRef);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to access destination folder" },
      { status: 403 },
    );
  }

  if (parsed.data.mergeIntoDestination && destination.id === "root") {
    return NextResponse.json(
      { error: "Choose a specific existing Drive folder to use partial-copy merge mode." },
      { status: 400 },
    );
  }

  if (parsed.data.existingDestinationItemIds.length && !parsed.data.mergeIntoDestination) {
    return NextResponse.json(
      { error: "Enable partial-copy merge mode before selecting already-copied items." },
      { status: 400 },
    );
  }

  const selectedDestinationItems = [];
  try {
    for (const itemId of parsed.data.existingDestinationItemIds) {
      selectedDestinationItems.push(await getAuthorizedDestinationItem(accessToken, itemId));
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to verify already-copied Drive items" },
      { status: 400 },
    );
  }

  let creation;
  try {
    creation = await createOrReuseMigration(cloudflare.DB, {
      userId: user.id,
      sourceFolderId: parsed.data.sourceFolderId,
      sourceFolderUrl: parsed.data.sourceFolderUrl,
      sourceFolderName: parsed.data.sourceFolderName,
      destinationFolderId: destination.id,
      destinationFolderName: destination.name,
      maxActive: normalizeActiveMigrationLimit(cloudflare.MAX_ACTIVE_MIGRATIONS_PER_USER),
    });
  } catch (error) {
    if (error instanceof ActiveMigrationQuotaError) {
      return NextResponse.json(
        {
          error: "You already have the maximum number of active migrations. Finish, cancel, or wait for one to complete before starting another.",
          maxActiveMigrations: normalizeActiveMigrationLimit(cloudflare.MAX_ACTIVE_MIGRATIONS_PER_USER),
        },
        { status: 429 },
      );
    }
    throw error;
  }

  if (creation.reused) {
    if (parsed.data.mergeIntoDestination || parsed.data.existingDestinationItemIds.length) {
      return NextResponse.json(
        {
          migrationId: creation.migration.id,
          status: creation.migration.status,
          error: "An active migration already exists for this source and destination. Cancel it before starting partial-copy merge mode.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      migrationId: creation.migration.id,
      status: creation.migration.status,
      reused: true,
    });
  }

  const migration = creation.migration;
  try {
    await saveManualDedupSelection(
      cloudflare.DB,
      migration.id,
      parsed.data.mergeIntoDestination,
      selectedDestinationItems,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save partial-copy selections";
    await setMigrationStatus(cloudflare.DB, migration.id, "paused", { errorMessage: message });
    return NextResponse.json({ migrationId: migration.id, status: "paused", error: message }, { status: 500 });
  }

  try {
    await publishMigrationJob(cloudflare, {
      type: "scan-folder",
      migrationId: migration.id,
      sourceFolderId: migration.sourceFolderId,
      sourceName: migration.sourceFolderName,
      sourcePath: migration.sourceFolderName,
      destinationFolderId: migration.destinationFolderId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare Queue is unavailable";
    await setMigrationStatus(cloudflare.DB, migration.id, "paused", { errorMessage: message });

    if (error instanceof FreeTierCapacityError) {
      return NextResponse.json(
        {
          migrationId: migration.id,
          status: "paused",
          error: message,
          resumesAfter: nextUtcReset(),
          zeroCostMode: true,
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { migrationId: migration.id, status: "paused", error: "Migration queue is temporarily unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.json({ migrationId: migration.id, status: migration.status, reused: false }, { status: 201 });
}
