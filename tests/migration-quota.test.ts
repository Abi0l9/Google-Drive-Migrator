import assert from "node:assert/strict";
import test from "node:test";
import {
  canCreateActiveMigration,
  canReserveMonthlyUsage,
  normalizeActiveMigrationLimit,
  normalizeMonthlyTransferBytesLimit,
  normalizeMonthlyTransferFilesLimit,
  usagePeriodFor,
} from "../lib/migration/quota";

test("uses a safe default for missing or invalid migration limits", () => {
  assert.equal(normalizeActiveMigrationLimit(undefined), 3);
  assert.equal(normalizeActiveMigrationLimit(""), 3);
  assert.equal(normalizeActiveMigrationLimit("nope"), 3);
  assert.equal(normalizeActiveMigrationLimit("0"), 3);
});

test("normalizes configured migration limits to positive integers", () => {
  assert.equal(normalizeActiveMigrationLimit("5"), 5);
  assert.equal(normalizeActiveMigrationLimit(2.9), 2);
  assert.equal(normalizeActiveMigrationLimit("1"), 1);
});

test("allows only counts below the configured active migration limit", () => {
  assert.equal(canCreateActiveMigration(0, 3), true);
  assert.equal(canCreateActiveMigration(2, 3), true);
  assert.equal(canCreateActiveMigration(3, 3), false);
  assert.equal(canCreateActiveMigration(4, 3), false);
});

test("normalizes monthly byte and file quotas", () => {
  assert.equal(normalizeMonthlyTransferBytesLimit("2048", 1024), 2048);
  assert.equal(normalizeMonthlyTransferBytesLimit("0", 1024), 1024);
  assert.equal(normalizeMonthlyTransferFilesLimit(250.9, 100), 250);
  assert.equal(normalizeMonthlyTransferFilesLimit("invalid", 100), 100);
});

test("uses stable UTC month buckets for usage accounting", () => {
  assert.equal(usagePeriodFor(new Date("2026-08-31T23:59:59.999Z")), "2026-08");
  assert.equal(usagePeriodFor(new Date("2026-09-01T00:00:00.000Z")), "2026-09");
});

test("reserves monthly usage only when both byte and file limits remain", () => {
  const limits = { bytes: 1_000, files: 10 };

  assert.equal(
    canReserveMonthlyUsage({ bytes: 400, files: 4 }, { bytes: 600, files: 6 }, limits),
    true,
  );
  assert.equal(
    canReserveMonthlyUsage({ bytes: 401, files: 4 }, { bytes: 600, files: 6 }, limits),
    false,
  );
  assert.equal(
    canReserveMonthlyUsage({ bytes: 400, files: 5 }, { bytes: 600, files: 6 }, limits),
    false,
  );
});
