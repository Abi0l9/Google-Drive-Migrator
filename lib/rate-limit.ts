import IORedis from "ioredis";
import { env } from "@/lib/env";

export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  distributed: boolean;
}

const localBuckets = new Map<string, RateLimitBucket>();
let redisClient: IORedis | undefined;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

function getRedisClient() {
  if (!redisClient || redisClient.status === "end") {
    redisClient = new IORedis(env.redisUrl, {
      connectTimeout: 1000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
    });
    redisClient.on("error", () => {
      // Rate limiting falls back to a process-local bucket if Redis is unavailable.
    });
  }

  return redisClient;
}

export async function rateLimit(key: string, limit = 20, windowMs = 60_000): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1000, Math.floor(windowMs));

  try {
    const redis = getRedisClient();
    const result = await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `gdm:ratelimit:${key}`,
      String(safeWindowMs),
    ) as [number | string, number | string];

    const count = Number(result[0]);
    const ttl = Math.max(0, Number(result[1]));
    return {
      allowed: count <= safeLimit,
      remaining: Math.max(safeLimit - count, 0),
      resetAt: Date.now() + ttl,
      distributed: true,
    };
  } catch {
    return consumeLocalRateLimit(localBuckets, key, safeLimit, safeWindowMs);
  }
}

export function consumeLocalRateLimit(
  buckets: Map<string, RateLimitBucket>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1000, Math.floor(windowMs));
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + safeWindowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: safeLimit - 1,
      resetAt,
      distributed: false,
    };
  }

  current.count += 1;
  return {
    allowed: current.count <= safeLimit,
    remaining: Math.max(safeLimit - current.count, 0),
    resetAt: current.resetAt,
    distributed: false,
  };
}
