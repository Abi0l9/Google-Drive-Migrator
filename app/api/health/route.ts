import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getScanQueue } from "@/lib/queue/migrations";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  const [database, redis] = await Promise.allSettled([
    connectDb(),
    getScanQueue().getJobCounts("waiting"),
  ]);

  const databaseOk = database.status === "fulfilled";
  const redisOk = redis.status === "fulfilled";
  const healthy = databaseOk && redisOk;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database: databaseOk ? "ok" : "unavailable",
      queue: redisOk ? "ok" : "unavailable",
    },
    {
      status: healthy ? 200 : 503,
      headers: noStoreHeaders,
    },
  );
}
