"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import type { ProgressSnapshot } from "@/types/migration";

interface ProgressPanelProps {
  migrationId: string;
}

export function ProgressPanel({ migrationId }: ProgressPanelProps) {
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadProgress = useCallback(async () => {
    try {
      const response = await fetch(`/api/migrations/${migrationId}`);
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to load migration progress");
        return;
      }

      setError(null);
      setProgress(payload);
    } catch {
      setError("Unable to refresh migration progress. Check your connection.");
    }
  }, [migrationId]);

  useEffect(() => {
    void loadProgress();
    const interval = window.setInterval(() => {
      void loadProgress();
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadProgress]);

  async function retryFailedFiles() {
    setRetrying(true);
    setError(null);

    try {
      const response = await fetch(`/api/migrations/${migrationId}/retry`, { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to retry failed files");
        return;
      }

      await loadProgress();
    } catch {
      setError("Unable to retry failed files. Check your connection and try again.");
    } finally {
      setRetrying(false);
    }
  }

  if (error && !progress) {
    return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }

  if (!progress) {
    return <Card>Loading migration progress...</Card>;
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase text-slate-500">Status</p>
            <h2 className="text-2xl font-bold capitalize text-slate-950">{progress.status ?? "pending"}</h2>
          </div>
          <strong className="text-3xl text-blue-600">{progress.percentage}%</strong>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-blue-600" style={{ width: `${Math.min(progress.percentage, 100)}%` }} />
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Completed</p><strong className="text-3xl">{progress.completedFiles}</strong></Card>
        <Card><p className="text-sm text-slate-500">Failed</p><strong className="text-3xl">{progress.failedFiles}</strong></Card>
        <Card><p className="text-sm text-slate-500">Total Files</p><strong className="text-3xl">{progress.totalFiles}</strong></Card>
      </section>

      <Card>
        <dl className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <div><dt className="text-slate-500">Current file</dt><dd className="font-medium">{progress.currentFile ?? "-"}</dd></div>
          <div><dt className="text-slate-500">Bytes copied</dt><dd className="font-medium">{formatBytes(progress.copiedBytes)} / {formatBytes(progress.totalBytes)}</dd></div>
        </dl>
      </Card>

      {progress.status === "failed" && progress.failedFiles > 0 ? (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">Some files did not transfer.</h3>
            <p className="text-sm text-slate-600">Retry only the failed files without rebuilding the migration.</p>
          </div>
          <Button onClick={retryFailedFiles} disabled={retrying}>
            {retrying ? "Retrying..." : `Retry ${progress.failedFiles} failed`}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
