import assert from "node:assert/strict";
import test from "node:test";
import { destinationFileName } from "../lib/google/drive";

test("adds Office extensions to supported Google Workspace files", () => {
  assert.equal(destinationFileName({ name: "Project brief", mimeType: "application/vnd.google-apps.document" }), "Project brief.docx");
  assert.equal(destinationFileName({ name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }), "Budget.xlsx");
  assert.equal(destinationFileName({ name: "Pitch deck", mimeType: "application/vnd.google-apps.presentation" }), "Pitch deck.pptx");
});

test("does not duplicate an existing Workspace export extension", () => {
  assert.equal(destinationFileName({ name: "Project brief.DOCX", mimeType: "application/vnd.google-apps.document" }), "Project brief.DOCX");
  assert.equal(destinationFileName({ name: "Budget.xlsx", mimeType: "application/vnd.google-apps.spreadsheet" }), "Budget.xlsx");
});

test("preserves ordinary file names and supplies a safe fallback", () => {
  assert.equal(destinationFileName({ name: "photo.jpg", mimeType: "image/jpeg" }), "photo.jpg");
  assert.equal(destinationFileName({ mimeType: "application/pdf" }), "Untitled file");
});
