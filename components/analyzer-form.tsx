"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import type { FolderAnalysis } from "@/types/migration";

export function AnalyzerForm() {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<FolderAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      <Button onClick={analyze} disabled={loading || !url}>{loading ? "Analyzing…" : "Analyze Folder"}</Button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {analysis ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <h3 className="mb-3 text-lg font-semibold text-slate-950">{analysis.folderName}</h3>
          <dl className="grid grid-cols-3 gap-3">
            <div><dt>Files</dt><dd className="font-bold">{analysis.files}</dd></div>
            <div><dt>Folders</dt><dd className="font-bold">{analysis.folders}</dd></div>
            <div><dt>Size</dt><dd className="font-bold">{(analysis.size / 1_000_000_000).toFixed(2)} GB</dd></div>
          </dl>
        </div>
      ) : null}
    </Card>
  );
}
