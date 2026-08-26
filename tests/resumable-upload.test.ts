import assert from "node:assert/strict";
import test from "node:test";
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  parseConfirmedOffset,
  shouldUseResumableUpload,
} from "../lib/google/resumable-upload";

test("uses resumable uploads only above the large-file threshold", () => {
  assert.equal(
    shouldUseResumableUpload({
      size: String(RESUMABLE_UPLOAD_THRESHOLD_BYTES),
      mimeType: "application/pdf",
    }),
    false,
  );

  assert.equal(
    shouldUseResumableUpload({
      size: String(RESUMABLE_UPLOAD_THRESHOLD_BYTES + 1),
      mimeType: "application/pdf",
    }),
    true,
  );
});

test("does not use resumable binary upload for Google Workspace exports", () => {
  assert.equal(
    shouldUseResumableUpload({
      size: String(RESUMABLE_UPLOAD_THRESHOLD_BYTES * 10),
      mimeType: "application/vnd.google-apps.document",
    }),
    false,
  );
});

test("parses the next confirmed resumable byte from Google's Range header", () => {
  assert.equal(parseConfirmedOffset("bytes=0-0"), 1);
  assert.equal(parseConfirmedOffset("bytes=0-8388607"), 8 * 1024 * 1024);
  assert.equal(parseConfirmedOffset("BYTES=0-16777215"), 16 * 1024 * 1024);
});

test("returns undefined for missing or malformed resumable Range headers", () => {
  assert.equal(parseConfirmedOffset(null), undefined);
  assert.equal(parseConfirmedOffset("bytes=100-200"), undefined);
  assert.equal(parseConfirmedOffset("not-a-range"), undefined);
});
