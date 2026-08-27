import assert from "node:assert/strict";
import test from "node:test";
import { classifyGoogleDriveError, googleDriveErrorDetails } from "../lib/google/error-classification";

test("retries Drive rate-limit reasons even when Google returns 403", () => {
  const error = {
    response: {
      status: 403,
      data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
    },
  };

  assert.equal(classifyGoogleDriveError(error), "retryable");
});

test("retries 429, 5xx, and transient network failures", () => {
  assert.equal(classifyGoogleDriveError({ response: { status: 429 } }), "retryable");
  assert.equal(classifyGoogleDriveError({ response: { status: 503 } }), "retryable");
  assert.equal(classifyGoogleDriveError({ code: "ECONNRESET" }), "retryable");
});

test("does not retry permission, invalid credential, or missing-file errors", () => {
  assert.equal(classifyGoogleDriveError({ response: { status: 403, data: { error: { errors: [{ reason: "insufficientFilePermissions" }] } } } }), "permanent");
  assert.equal(classifyGoogleDriveError({ response: { status: 401 } }), "permanent");
  assert.equal(classifyGoogleDriveError({ response: { status: 404 } }), "permanent");
});

test("turns Drive 401 responses into actionable reconnect details", () => {
  const details = googleDriveErrorDetails({ response: { status: 401 }, message: "Invalid Credentials" });
  assert.equal(details.status, 401);
  assert.equal(details.networkCode, "GOOGLE_REAUTH_REQUIRED");
  assert.match(details.message, /needs to be reconnected/i);
});

test("does not retry GDM unsupported Drive item errors", () => {
  assert.equal(classifyGoogleDriveError({
    code: "GDM_UNSUPPORTED_DRIVE_ITEM",
    message: "Google Drive shortcuts are not copied",
  }), "permanent");
});

test("does not retry explicit Google reconnect-required errors", () => {
  assert.equal(classifyGoogleDriveError({
    code: "GOOGLE_REAUTH_REQUIRED",
    message: "Google Drive access needs to be reconnected.",
  }), "permanent");
});

test("extracts status from resumable upload error messages", () => {
  const details = googleDriveErrorDetails(new Error("Google Drive resumable upload failed (503): backend unavailable"));
  assert.equal(details.status, 503);
  assert.equal(classifyGoogleDriveError(new Error("Google Drive resumable upload failed (503)")), "retryable");
});

test("leaves unrecognized application failures available for normal BullMQ retry policy", () => {
  assert.equal(classifyGoogleDriveError(new Error("Unexpected parser failure")), "unknown");
});
