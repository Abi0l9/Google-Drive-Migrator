import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/google/drive.ts", import.meta.url), "utf8");
const match = source.match(/export function extractDriveFolderId\([^)]*\)\s*(?::\s*[^{]+)?\s*\{[\s\S]*?\n\}/);
assert.ok(match, "extractDriveFolderId function should exist");

const jsFunction = match[0]
  .replace("export function", "function")
  .replace("folderUrl: string", "folderUrl");
const extractDriveFolderId = new Function(`${jsFunction}; return extractDriveFolderId;`)();

assert.equal(extractDriveFolderId("https://drive.google.com/drive/folders/abc_123-XYZ"), "abc_123-XYZ");
assert.equal(extractDriveFolderId("https://drive.google.com/open?id=folder123"), "folder123");
assert.throws(() => extractDriveFolderId("https://example.com/not-drive"), /Invalid Google Drive Folder URL/);
