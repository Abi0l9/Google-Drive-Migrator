import assert from "node:assert/strict";
import test from "node:test";
import { transferredBytes, updateTransferMetrics } from "../lib/migration/progress-metrics";

test("counts completed bytes plus current resumable file progress", () => {
  assert.equal(transferredBytes({ copiedBytes: 100, currentFileUploadedBytes: 25 }), 125);
  assert.equal(transferredBytes({ copiedBytes: -100, currentFileUploadedBytes: 10 }), 0);
});

test("derives transfer speed and ETA from consecutive running samples", () => {
  const first = updateTransferMetrics(undefined, {
    status: "running",
    copiedBytes: 1_000,
    currentFileUploadedBytes: 0,
    totalBytes: 5_000,
  }, 1_000);

  const second = updateTransferMetrics(first.sample, {
    status: "running",
    copiedBytes: 2_000,
    currentFileUploadedBytes: 0,
    totalBytes: 5_000,
  }, 2_000);

  assert.equal(second.rateBytesPerSecond, 1_000);
  assert.equal(second.etaSeconds, 3);
});

test("smooths noisy rate changes rather than replacing the previous rate", () => {
  const first = updateTransferMetrics(undefined, {
    status: "running",
    copiedBytes: 0,
    totalBytes: 10_000,
  }, 0);
  const second = updateTransferMetrics(first.sample, {
    status: "running",
    copiedBytes: 1_000,
    totalBytes: 10_000,
  }, 1_000);
  const third = updateTransferMetrics(second.sample, {
    status: "running",
    copiedBytes: 3_000,
    totalBytes: 10_000,
  }, 2_000);

  assert.equal(second.rateBytesPerSecond, 1_000);
  assert.equal(third.rateBytesPerSecond, 1_300);
});

test("drops stale speed and ETA after ten seconds without movement", () => {
  const first = updateTransferMetrics(undefined, {
    status: "running",
    copiedBytes: 0,
    totalBytes: 10_000,
  }, 0);
  const moving = updateTransferMetrics(first.sample, {
    status: "running",
    copiedBytes: 1_000,
    totalBytes: 10_000,
  }, 1_000);
  const stalled = updateTransferMetrics(moving.sample, {
    status: "running",
    copiedBytes: 1_000,
    totalBytes: 10_000,
  }, 11_000);

  assert.equal(stalled.rateBytesPerSecond, undefined);
  assert.equal(stalled.etaSeconds, undefined);
});

test("does not report speed or ETA outside the running state", () => {
  const metrics = updateTransferMetrics({
    at: 1_000,
    bytes: 1_000,
    lastMovementAt: 1_000,
    rateBytesPerSecond: 1_000,
  }, {
    status: "paused",
    copiedBytes: 1_000,
    totalBytes: 10_000,
  }, 2_000);

  assert.equal(metrics.rateBytesPerSecond, undefined);
  assert.equal(metrics.etaSeconds, undefined);
  assert.equal(metrics.sample.rateBytesPerSecond, undefined);
});
