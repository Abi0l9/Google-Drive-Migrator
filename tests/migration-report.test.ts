import assert from "node:assert/strict";
import test from "node:test";
import { buildMigrationCsv, csvValue, safeReportFileName } from "../lib/migration/report";

test("escapes CSV values containing commas, quotes, and newlines", () => {
  assert.equal(csvValue("plain"), "plain");
  assert.equal(csvValue("hello,world"), '"hello,world"');
  assert.equal(csvValue('He said "go"'), '"He said ""go"""');
  assert.equal(csvValue("line 1\nline 2"), '"line 1\nline 2"');
});

test("sanitizes migration report filenames and keeps them bounded", () => {
  assert.equal(safeReportFileName("Team Files / Q3 🚀"), "Team-Files-Q3");
  assert.equal(safeReportFileName("***"), "migration");
  assert.ok(safeReportFileName("a".repeat(200)).length <= 80);
});

test("builds stable file-by-file migration CSV output", () => {
  const csv = buildMigrationCsv([
    {
      type: "file",
      name: "Sales, Q3.csv",
      path: "Root/Sales, Q3.csv",
      mimeType: "text/csv",
      size: 42,
      status: "failed",
      destinationFolderId: "folder-1",
      retryCount: 2,
      error: 'Permission denied: "owner only"',
    },
  ]);

  const lines = csv.split("\n");
  assert.equal(lines[0], "type,name,path,mime_type,size_bytes,status,destination_file_id,destination_folder_id,retry_count,error");
  assert.equal(
    lines[1],
    'file,"Sales, Q3.csv","Root/Sales, Q3.csv",text/csv,42,failed,,folder-1,2,"Permission denied: ""owner only"""',
  );
});
