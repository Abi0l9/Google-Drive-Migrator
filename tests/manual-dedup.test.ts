import assert from "node:assert/strict";
import test from "node:test";
import { buildManualDuplicateLookup } from "../lib/cloudflare/manual-dedup";

test("ordinary manually selected files require exact name and size", () => {
  assert.deepEqual(
    buildManualDuplicateLookup({ name: "archive.zip", size: 8192 }),
    { name: "archive.zip", size: 8192 },
  );
});

test("Workspace exports use the selected Office file name and MIME type", () => {
  assert.deepEqual(
    buildManualDuplicateLookup({
      name: "Budget.xlsx",
      size: 0,
      workspaceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    {
      name: "Budget.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  );
});
