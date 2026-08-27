import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getMigrationForUser, getUserByEmail } from "@/lib/cloudflare/d1";

const pausableStatuses = new Set(["pending", "scanning", "running"]);

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
  if (migration.status === "paused") return NextResponse.json({ status: migration.status });
  if (!pausableStatuses.has(migration.status)) {
    return NextResponse.json({ error: `A ${migration.status} migration cannot be paused` }, { status: 409 });
  }

  await cloudflare.DB.batch([
    cloudflare.DB.prepare(`
      UPDATE migrations
      SET status = 'paused', completed_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status IN ('pending','scanning','running')
    `).bind(id, user.id),
    cloudflare.DB.prepare(`
      UPDATE migration_items
      SET status = 'pending', transfer_job_id = NULL, transfer_lease_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE migration_id = ? AND status = 'copying'
    `).bind(id),
  ]);

  return NextResponse.json({ status: "paused" });
}
