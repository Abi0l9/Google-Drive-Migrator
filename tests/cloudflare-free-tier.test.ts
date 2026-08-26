import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET,
  estimatedQueueOperations,
  nextUtcReset,
  normalizeDailyQueueMessageBudget,
  utcUsageDate,
} from "../lib/cloudflare/free-tier";

test("uses a conservative default queue message budget", () => {
  assert.equal(normalizeDailyQueueMessageBudget(undefined), DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET);
  assert.equal(estimatedQueueOperations(DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET), 6600);
});

test("caps configured queue messages below the Cloudflare Free operations ceiling", () => {
  assert.equal(normalizeDailyQueueMessageBudget("999999"), 2500);
  assert.equal(estimatedQueueOperations(2500), 7500);
});

test("normalizes unsafe queue budget values", () => {
  assert.equal(normalizeDailyQueueMessageBudget("0"), DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET);
  assert.equal(normalizeDailyQueueMessageBudget("nope"), DEFAULT_DAILY_QUEUE_MESSAGE_BUDGET);
  assert.equal(normalizeDailyQueueMessageBudget(1200.9), 1200);
});

test("uses UTC boundaries for daily free-tier resets", () => {
  const now = new Date("2026-08-26T23:59:59.000Z");
  assert.equal(utcUsageDate(now), "2026-08-26");
  assert.equal(nextUtcReset(now), "2026-08-27T00:00:00.000Z");
});
