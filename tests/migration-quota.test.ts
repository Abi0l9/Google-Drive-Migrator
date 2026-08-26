import assert from "node:assert/strict";
import test from "node:test";
import { canCreateActiveMigration, normalizeActiveMigrationLimit } from "../lib/migration/quota";

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
