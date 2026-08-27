import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getMigrationForUser, getUserByEmail, setMigrationStatus } from "@/lib/cloudflare/d1";
import { FreeTierCapacityError, nextUtcReset } from "@/lib/cloudflare/free-tier";
import { publishMigrationJob, publishMigrationJobs } from "@/lib/cloudflare/queue";

const alreadyActiveStatuses = new Set(["pending", "scanning", "running"]);

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const cloudflare = getGdmCloudflareEnv();
  const { id } = await params;
  const user = await getUserByEmail(cloudflare.DB, session.user.email);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const migration = await getMigrationForUser(cloudflare.DB, id, user.id);
  if (!migration) return NextResponse.json({ error: "Migration not found" }, { status: 404 });
  if (alreadyActiveStatuses.has(migration.status)) return NextResponse.json({ status: migration.status });
  if (migration.status !== "paused") {
    return NextResponse.json({ error: `A ${migration.status} migration cannot be resumed` }, { status: 409 });
  }

  const scanCompleted = Boolean(migration.scanCompleted);
  const resumedStatus = scanCompleted ? "running" : "scanning";
  await cloudflare.DB.batch([
    cloudflare.DB.prepare(`
      UPDATE migrations
      SET status = ?, completed_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 'paused'
    `).bind(resumedStatus, id, user.id),
    cloudflare.DB.prepare(`
      UPDATE migration_items
      SET status = 'pending', transfer_job_id = NULL, transfer_lease_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE migration_id = ? AND status = 'copying'
    `).bind(id),
  ]);

  try {
    if (scanCompleted) {
      await publishMigrationJob(cloudflare, { type: "dispatch-pending", migrationId: id });
    } else {
      await publishMigrationJobs(cloudflare, [
        {
          type: "scan-folder",
          migrationId: id,
          sourceFolderId: migration.sourceFolderId,
          sourceName: migration.sourceFolderName,
          sourcePath: migration.sourceFolderName,
          destinationFolderId: migration.destinationFolderId,
        },
        { type: "dispatch-pending", migrationId: id },
      ]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration queue unavailable";
    await setMigrationStatus(cloudflare.DB, id, "paused", { errorMessage: message });
    if (error instanceof FreeTierCapacityError) {
      return NextResponse.json(
        { error: message, status: "paused", resumesAfter: nextUtcReset(), zeroCostMode: true },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Migration queue is unavailable. Try again shortly." }, { status: 503 });
  }

  return NextResponse.json({ status: resumedStatus, scanCompleted });
}
