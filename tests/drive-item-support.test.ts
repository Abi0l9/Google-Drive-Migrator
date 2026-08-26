import assert from "node:assert/strict";
import test from "node:test";
import { assertCopyableDriveFile, UnsupportedDriveItemError } from "../lib/google/drive";

const supportedWorkspaceMimeTypes = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
];

test("allows ordinary files and supported Workspace exports", () => {
  assert.doesNotThrow(() => assertCopyableDriveFile({ mimeType: "application/pdf" }));

  for (const mimeType of supportedWorkspaceMimeTypes) {
    assert.doesNotThrow(() => assertCopyableDriveFile({ mimeType }));
  }
});

test("rejects Google Drive shortcuts with a permanent application code", () => {
  assert.throws(
    () => assertCopyableDriveFile({ mimeType: "application/vnd.google-apps.shortcut" }),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedDriveItemError);
      assert.equal(error.code, "GDM_UNSUPPORTED_DRIVE_ITEM");
      assert.match(error.message, /shortcuts are not copied/i);
      return true;
    },
  );
});

test("rejects unsupported Google Workspace item types", () => {
  assert.throws(
    () => assertCopyableDriveFile({ mimeType: "application/vnd.google-apps.form" }),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedDriveItemError);
      assert.equal(error.code, "GDM_UNSUPPORTED_DRIVE_ITEM");
      assert.match(error.message, /does not have a supported migration export/i);
      return true;
    },
  );
});
