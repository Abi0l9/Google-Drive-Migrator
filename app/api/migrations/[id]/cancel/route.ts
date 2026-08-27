import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import {
  getMigrationForUser,
  getUserByEmail,
  markPendingItemsSkipped,
} from "@/lib/cloudflare/d1";

const cancellableStatuses = new Set(["pending", "scanning", "running", "paused"]);

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
  if (migration.status === "cancelled") return NextResponse.json({ status: migration.status });
  if (!cancellableStatuses.has(migration.status)) {
    return NextResponse.json({ error: `A ${migration.status} migration cannot be cancelled` }, { status: 409 });
  }

  await cloudflare.DB.prepare(`
    UPDATE migrations
    SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND status IN ('pending','scanning','running','paused')
  `).bind(id, user.id).run();
  await markPendingItemsSkipped(cloudflare.DB, id, "Migration cancelled");

  return NextResponse.json({ status: "cancelled" });
}
