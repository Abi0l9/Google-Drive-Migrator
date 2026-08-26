import assert from "node:assert/strict";
import test from "node:test";
import { consumeLocalRateLimit, type RateLimitBucket } from "../lib/rate-limit";

test("local rate limiter allows requests until the configured limit", () => {
  const buckets = new Map<string, RateLimitBucket>();
  const now = 1_000_000;

  const first = consumeLocalRateLimit(buckets, "user-1", 2, 60_000, now);
  const second = consumeLocalRateLimit(buckets, "user-1", 2, 60_000, now + 1);
  const third = consumeLocalRateLimit(buckets, "user-1", 2, 60_000, now + 2);

  assert.deepEqual(
    [first.allowed, second.allowed, third.allowed],
    [true, true, false],
  );
  assert.equal(first.remaining, 1);
  assert.equal(second.remaining, 0);
  assert.equal(third.remaining, 0);
  assert.equal(first.distributed, false);
});

test("local rate limiter resets after the window expires", () => {
  const buckets = new Map<string, RateLimitBucket>();
  const first = consumeLocalRateLimit(buckets, "user-1", 1, 5_000, 10_000);
  const blocked = consumeLocalRateLimit(buckets, "user-1", 1, 5_000, 10_100);
  const reset = consumeLocalRateLimit(buckets, "user-1", 1, 5_000, first.resetAt);

  assert.equal(first.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(reset.allowed, true);
  assert.ok(reset.resetAt > first.resetAt);
});

test("local rate limiter normalizes unsafe limits and windows", () => {
  const buckets = new Map<string, RateLimitBucket>();
  const result = consumeLocalRateLimit(buckets, "user-1", 0, 10, 100);

  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
  assert.equal(result.resetAt, 1_100);
});
