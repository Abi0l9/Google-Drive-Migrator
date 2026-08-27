import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getMigrationForUser, getUserByEmail, setMigrationStatus } from "@/lib/cloudflare/d1";
import { reconcileMigrationCounters } from "@/lib/cloudflare/d1-jobs";
import { FreeTierCapacityError, nextUtcReset } from "@/lib/cloudflare/free-tier";
import { publishMigrationJob } from "@/lib/cloudflare/queue";

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
  if (migration.status === "cancelled") {
    return NextResponse.json({ error: "A cancelled migration cannot be retried" }, { status: 409 });
  }

  const reset = await cloudflare.DB.prepare(`
    UPDATE migration_items
    SET status = 'pending',
        retry_count = 0,
        error_message = NULL,
        transfer_job_id = NULL,
        transfer_lease_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE migration_id = ? AND item_type = 'file' AND status = 'failed'
  `).bind(id).run();
  const retried = reset.meta.changes ?? 0;

  if (!retried) {
    return NextResponse.json({ retried: 0, status: migration.status });
  }

  await cloudflare.DB.prepare(`
    UPDATE migrations
    SET status = 'running', completed_at = NULL, error_message = NULL, failed_files = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).bind(id, user.id).run();
  await reconcileMigrationCounters(cloudflare.DB, id);

  try {
    await publishMigrationJob(cloudflare, { type: "dispatch-pending", migrationId: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration queue unavailable";
    await setMigrationStatus(cloudflare.DB, id, "paused", { errorMessage: message });
    if (error instanceof FreeTierCapacityError) {
      return NextResponse.json(
        { retried, status: "paused", error: message, resumesAfter: nextUtcReset(), zeroCostMode: true },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { retried, status: "paused", error: "Migration queue is unavailable. Resume when it is available." },
      { status: 503 },
    );
  }

  return NextResponse.json({ retried, status: "running" });
}
