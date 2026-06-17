import { Queue, Worker, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

const defaultJobOptions: JobsOptions = { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: false };

export const scanQueue = new Queue("scan", { connection, defaultJobOptions });
export const transferQueue = new Queue("transfer", { connection, defaultJobOptions });
export const retryQueue = new Queue("retry", { connection, defaultJobOptions });
export const reportQueue = new Queue("report", { connection, defaultJobOptions });

export function createMigrationWorker<T>(name: string, processor: ConstructorParameters<typeof Worker<T>>[1]) {
  return new Worker<T>(name, processor, { connection, concurrency: 4 });
}
