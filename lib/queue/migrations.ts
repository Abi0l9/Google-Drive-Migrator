import { Queue, Worker, JobsOptions, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

let connection: ConnectionOptions | undefined;
let redisClient: IORedis | undefined;
const queues = new Map<string, Queue>();

function getConnection() {
  if (!connection) {
    redisClient = new IORedis(env.redisUrl, {
      connectTimeout: 1000,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    redisClient.on("error", () => {
      // Callers handle queue failures; avoid noisy unhandled Redis logs in local dev.
    });
    connection = redisClient as unknown as ConnectionOptions;
  }
  return connection;
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

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

export async function closeMigrationQueueResources() {
  await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
  queues.clear();

  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
  }

  redisClient = undefined;
  connection = undefined;
}
