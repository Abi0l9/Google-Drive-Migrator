import { NextResponse } from "next/server";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getRuntimeActivity } from "@/lib/cloudflare/d1";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  const cloudflare = getGdmCloudflareEnv();

  try {
    await cloudflare.DB.prepare("SELECT 1 AS ok").first();
    const [lastBatch, lastSuccess] = await Promise.all([
      getRuntimeActivity(cloudflare.DB, "jobs:last_batch"),
      getRuntimeActivity(cloudflare.DB, "jobs:last_success"),
    ]);

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        queue: cloudflare.MIGRATION_QUEUE ? "ok" : "unavailable",
        worker: lastBatch ? "active" : "idle",
        workerLastBatchAt: lastBatch?.updatedAt ?? null,
        workerLastSuccessAt: lastSuccess?.updatedAt ?? null,
        runtime: "cloudflare-workers-free",
      },
      { status: cloudflare.MIGRATION_QUEUE ? 200 : 503, headers: noStoreHeaders },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        database: "unavailable",
        queue: cloudflare.MIGRATION_QUEUE ? "ok" : "unavailable",
        worker: "unknown",
        workerLastBatchAt: null,
        workerLastSuccessAt: null,
        runtime: "cloudflare-workers-free",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
