import { Queue, Worker, JobsOptions, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

let connection: ConnectionOptions | undefined;
const queues = new Map<string, Queue>();

function getConnection() {
  if (!connection) {
    const client = new IORedis(env.redisUrl, {
      connectTimeout: 1000,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      // Callers handle queue failures; avoid noisy unhandled Redis logs in local dev.
    });
    connection = client as unknown as ConnectionOptions;
  }
  return connection;
}

const defaultJobOptions: JobsOptions = { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: false };

function getQueue(name: string) {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getConnection(), defaultJobOptions });
    queues.set(name, queue);
  }
  return queue;
}

export function getScanQueue() {
  return getQueue("scan");
}

export function getTransferQueue() {
  return getQueue("transfer");
}

export function getRetryQueue() {
  return getQueue("retry");
}

export function getReportQueue() {
  return getQueue("report");
}

export function createMigrationWorker<T>(name: string, processor: ConstructorParameters<typeof Worker<T>>[1], concurrency = 4) {
  return new Worker<T>(name, processor, { connection: getConnection(), concurrency });
}
