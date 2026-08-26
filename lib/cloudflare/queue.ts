import type { MigrationJob } from "@/lib/cloudflare/jobs";
import {
  releaseQueueMessages,
  reserveQueueMessages,
} from "@/lib/cloudflare/d1";

export interface QueuePublisherEnv {
  DB: D1Database;
  MIGRATION_QUEUE: Queue<MigrationJob>;
  GDM_DAILY_QUEUE_MESSAGE_BUDGET?: string;
}

export async function publishMigrationJob(env: QueuePublisherEnv, job: MigrationJob) {
  await reserveQueueMessages(env.DB, 1, env.GDM_DAILY_QUEUE_MESSAGE_BUDGET);
  try {
    await env.MIGRATION_QUEUE.send(job, { contentType: "json" });
  } catch (error) {
    await releaseQueueMessages(env.DB, 1).catch(() => undefined);
    throw error;
  }
}

export async function publishMigrationJobs(env: QueuePublisherEnv, jobs: MigrationJob[]) {
  if (!jobs.length) return;
  await reserveQueueMessages(env.DB, jobs.length, env.GDM_DAILY_QUEUE_MESSAGE_BUDGET);
  try {
    await env.MIGRATION_QUEUE.sendBatch(
      jobs.map((body) => ({ body, contentType: "json" as const })),
    );
  } catch (error) {
    await releaseQueueMessages(env.DB, jobs.length).catch(() => undefined);
    throw error;
  }
}
