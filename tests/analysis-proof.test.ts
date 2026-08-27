import assert from "node:assert/strict";
import test from "node:test";
import { issueAnalysisProof, verifyAnalysisProof } from "../lib/migration/analysis-proof";

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY ?? "analysis-proof-test-key";

const analysis = {
  folderId: "folder-123",
  folderName: "Public Source",
  files: 12,
  folders: 3,
  size: 4096,
};

test("issues authenticated folder analysis proofs", () => {
  const now = Date.parse("2026-08-27T20:00:00.000Z");
  const token = issueAnalysisProof(analysis, now);
  const verified = verifyAnalysisProof(token, analysis.folderId, now + 5 * 60 * 1000);

  assert.deepEqual(verified, { ...analysis, issuedAt: now });
});

test("rejects analysis proofs for a different source folder", () => {
  const now = Date.parse("2026-08-27T20:00:00.000Z");
  const token = issueAnalysisProof(analysis, now);

  assert.equal(verifyAnalysisProof(token, "different-folder", now), null);
});

test("rejects expired analysis proofs", () => {
  const now = Date.parse("2026-08-27T20:00:00.000Z");
  const token = issueAnalysisProof(analysis, now);

  assert.equal(verifyAnalysisProof(token, analysis.folderId, now + 31 * 60 * 1000), null);
});

test("rejects tampered analysis proofs", () => {
  const now = Date.parse("2026-08-27T20:00:00.000Z");
  const token = issueAnalysisProof(analysis, now);
  const replacement = token.endsWith("A") ? "B" : "A";
  const tampered = `${token.slice(0, -1)}${replacement}`;

  assert.equal(verifyAnalysisProof(tampered, analysis.folderId, now), null);
});
