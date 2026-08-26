import { randomUUID } from "node:crypto";
import { Queue, Worker, JobsOptions, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

let connection: ConnectionOptions | undefined;
let redisClient: IORedis | undefined;
const queues = new Map<string, Queue>();
const WORKER_HEARTBEAT_KEY = "gdm:worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SECONDS = 30;
const CREATION_LOCK_TTL_MS = 10_000;
const CREATION_LOCK_WAIT_ATTEMPTS = 10;
const CREATION_LOCK_WAIT_MS = 100;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class MigrationCreationLockBusyError extends Error {
  constructor() {
    super("Another migration request is already being processed for this account");
    this.name = "MigrationCreationLockBusyError";
  }
}

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

function getRedisClient() {
  getConnection();
  if (!redisClient) throw new Error("Redis client unavailable");
  return redisClient;
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

export async function withMigrationCreationLock<T>(userId: string, operation: () => Promise<T>) {
  const redis = getRedisClient();
  const key = `gdm:migration-create-lock:${userId}`;
  const token = randomUUID();
  let acquired = false;

  for (let attempt = 0; attempt < CREATION_LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const result = await redis.set(key, token, "PX", CREATION_LOCK_TTL_MS, "NX");
    if (result === "OK") {
      acquired = true;
      break;
    }
    await sleep(CREATION_LOCK_WAIT_MS);
  }

  if (!acquired) throw new MigrationCreationLockBusyError();

  try {
    return await operation();
  } finally {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token).catch(() => undefined);
  }
}

export async function touchMigrationWorkerHeartbeat() {
  const heartbeatAt = new Date().toISOString();
  await getRedisClient().set(WORKER_HEARTBEAT_KEY, heartbeatAt, "EX", WORKER_HEARTBEAT_TTL_SECONDS);
  return heartbeatAt;
}

export async function getMigrationWorkerHeartbeat() {
  return getRedisClient().get(WORKER_HEARTBEAT_KEY);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
