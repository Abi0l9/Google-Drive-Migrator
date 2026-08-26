import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getMigrationWorkerHeartbeat, getScanQueue } from "@/lib/queue/migrations";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  const [database, redis, workerHeartbeat] = await Promise.allSettled([
    connectDb(),
    getScanQueue().getJobCounts("waiting"),
    getMigrationWorkerHeartbeat(),
  ]);

  const databaseOk = database.status === "fulfilled";
  const redisOk = redis.status === "fulfilled";
  const workerHeartbeatAt = workerHeartbeat.status === "fulfilled" ? workerHeartbeat.value : null;
  const workerOk = Boolean(workerHeartbeatAt);
  const webReady = databaseOk && redisOk;
  const fullyOperational = webReady && workerOk;

  return NextResponse.json(
    {
      status: fullyOperational ? "ok" : webReady ? "degraded" : "unavailable",
      database: databaseOk ? "ok" : "unavailable",
      queue: redisOk ? "ok" : "unavailable",
      worker: workerOk ? "ok" : "unavailable",
      workerHeartbeatAt,
    },
    {
      status: webReady ? 200 : 503,
      headers: noStoreHeaders,
    },
  );
}
