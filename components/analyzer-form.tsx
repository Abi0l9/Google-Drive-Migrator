"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import type { FolderAnalysis } from "@/types/migration";

interface AnalyzerFormProps {
  isAuthenticated: boolean;
  authConfigured: boolean;
}

export function AnalyzerForm({ isAuthenticated, authConfigured }: AnalyzerFormProps) {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<FolderAnalysis | null>(null);
  const [destinationMode, setDestinationMode] = useState<"root" | "folder">("root");
  const [destinationFolderId, setDestinationFolderId] = useState("");
  const [destinationFolderName, setDestinationFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderUrl: url }),
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "Unable to analyze folder");
      return;
    }
    setAnalysis(payload);
  }

  async function startMigration() {
    if (!analysis) return;

    setCreating(true);
    setError(null);

    const destinationId = destinationMode === "root" ? "root" : destinationFolderId.trim();
    const destinationName = destinationMode === "root" ? "My Drive" : destinationFolderName.trim();
    const response = await fetch("/api/migrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceFolderId: analysis.folderId,
        sourceFolderUrl: url,
        sourceFolderName: analysis.folderName,
        destinationFolderId: destinationId,
        destinationFolderName: destinationName,
      }),
    });
    const payload = await response.json();
    setCreating(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to start migration");
      return;
    }

    window.location.href = `/migrations/${payload.migrationId}`;
  }

  return (
    <Card className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="folderUrl">Public Drive folder URL</label>
        <input
          id="folderUrl"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://drive.google.com/drive/folders/xxxxxxxx"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
        />
      </div>
      <Button onClick={analyze} disabled={loading || !url}>{loading ? "Analyzing..." : "Analyze Folder"}</Button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {analysis ? (
        <div className="space-y-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-950">{analysis.folderName}</h3>
            <dl className="grid grid-cols-3 gap-3">
              <div><dt>Files</dt><dd className="font-bold">{analysis.files}</dd></div>
              <div><dt>Folders</dt><dd className="font-bold">{analysis.folders}</dd></div>
              <div><dt>Size</dt><dd className="font-bold">{formatBytes(analysis.size)}</dd></div>
            </dl>
          </div>

          <fieldset className="space-y-3">
            <legend className="font-medium text-slate-950">Destination</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={destinationMode === "root"}
                onChange={() => setDestinationMode("root")}
              />
              My Drive root
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={destinationMode === "folder"}
                onChange={() => setDestinationMode("folder")}
              />
              Existing Drive folder ID
            </label>
            {destinationMode === "folder" ? (
              <div className="grid gap-3">
                <input
                  value={destinationFolderId}
                  onChange={(event) => setDestinationFolderId(event.target.value)}
                  placeholder="Destination folder ID"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
                />
                <input
                  value={destinationFolderName}
                  onChange={(event) => setDestinationFolderName(event.target.value)}
                  placeholder="Destination folder name"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none ring-blue-500 focus:ring-2"
                />
              </div>
            ) : null}
          </fieldset>

          <Button
            onClick={startMigration}
            disabled={
              creating ||
              !isAuthenticated ||
              (destinationMode === "folder" && (!destinationFolderId.trim() || !destinationFolderName.trim()))
            }
          >
            {creating ? "Starting..." : "Start Migration"}
          </Button>
          {!authConfigured ? <p className="text-sm text-red-700">Set a real Google OAuth client ID and secret before starting a migration.</p> : null}
          {authConfigured && !isAuthenticated ? <p className="text-sm text-slate-600">Sign in with Google before starting a migration.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
