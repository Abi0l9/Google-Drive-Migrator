"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleReconnectLink } from "@/components/google-reconnect-link";
import { Button, Card } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { messageNeedsGoogleReauthorization } from "@/lib/google/auth-errors";
import {
  updateTransferMetrics,
  type TransferSample,
} from "@/lib/migration/progress-metrics";
import type { ProgressSnapshot } from "@/types/migration";

interface ProgressPanelProps {
  migrationId: string;
}

function formatEta(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function ProgressPanel({ migrationId }: ProgressPanelProps) {
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [transferRate, setTransferRate] = useState<number | undefined>();
  const [etaSeconds, setEtaSeconds] = useState<number | undefined>();
  const transferSampleRef = useRef<TransferSample | undefined>(undefined);

  const loadProgress = useCallback(async () => {
    try {
      const response = await fetch(`/api/migrations/${migrationId}`);
      const payload = await response.json() as ProgressSnapshot & { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to load migration progress");
        return;
      }

      const metrics = updateTransferMetrics(transferSampleRef.current, payload);
      transferSampleRef.current = metrics.sample;
      setTransferRate(metrics.rateBytesPerSecond);
      setEtaSeconds(metrics.etaSeconds);
      setError(null);
      setProgress(payload);
    } catch {
      setError("Unable to refresh migration progress. Check your connection.");
    }
  }, [migrationId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadProgress();
    }, 0);
    const interval = window.setInterval(() => {
      void loadProgress();
    }, 3000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadProgress]);

  async function runMigrationAction(
    action: "pause" | "resume" | "cancel",
    setBusy: (value: boolean) => void,
    fallbackError: string,
  ) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/migrations/${migrationId}/${action}`, { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? fallbackError);
        return;
      }

      await loadProgress();
    } catch {
      setError(`${fallbackError}. Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function cancelMigration() {
    await runMigrationAction("cancel", setCancelling, "Unable to cancel migration");
  }

  async function pauseMigration() {
    await runMigrationAction("pause", setPausing, "Unable to pause migration");
  }

  async function resumeMigration() {
    await runMigrationAction("resume", setResuming, "Unable to resume migration");
  }

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

  const currentFileTotalBytes = progress.currentFileTotalBytes ?? 0;
  const hasCurrentFileProgress = Boolean(progress.currentFile && currentFileTotalBytes > 0);
  const currentFilePercentage = hasCurrentFileProgress
    ? Math.min(100, Math.round(((progress.currentFileUploadedBytes ?? 0) / currentFileTotalBytes) * 100))
    : 0;
  const active = ["pending", "scanning", "running"].includes(progress.status ?? "");
  const etaLabel = formatEta(etaSeconds);
  const reauthRequired = messageNeedsGoogleReauthorization(progress.errorMessage)
    || Boolean(progress.failedItems?.some((item) => messageNeedsGoogleReauthorization(item.error)));

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

      {progress.errorMessage ? (
        <p className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{progress.errorMessage}</p>
      ) : null}

      {reauthRequired ? (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-slate-950">Google Drive needs to be reconnected</h3>
              <p className="mt-1 text-sm text-slate-700">
                Your migration record is safe. Reconnect Google Drive, return here, then retry the failed transfer.
              </p>
            </div>
            <GoogleReconnectLink redirectTo={`/migrations/${migrationId}`} />
          </div>
        </Card>
      ) : null}

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
        {progress.status === "running" ? (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Transfer speed</p>
              <p className="font-semibold text-slate-950">
                {transferRate ? `${formatBytes(transferRate)}/s` : "Calculating from live progress..."}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Estimated time remaining</p>
              <p className="font-semibold text-slate-950">
                {etaLabel ?? (transferRate ? "Finishing..." : "Waiting for transfer activity...")}
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {active ? (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">Migration controls</h3>
            <p className="text-sm text-slate-600">
              Pause keeps resumable upload progress. Cancel stops the migration permanently.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={pauseMigration} disabled={pausing || cancelling}>
              {pausing ? "Pausing..." : "Pause"}
            </Button>
            <Button onClick={cancelMigration} disabled={cancelling || pausing}>
              {cancelling ? "Cancelling..." : "Cancel migration"}
            </Button>
          </div>
        </Card>
      ) : null}

      {progress.status === "paused" ? (
        <Card className="flex flex-col gap-4 border-amber-200 bg-amber-50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">Migration paused</h3>
            <p className="text-sm text-slate-600">
              Completed files stay completed, and resumable large-file sessions keep their confirmed byte position.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={resumeMigration} disabled={resuming || cancelling}>
              {resuming ? "Resuming..." : "Resume migration"}
            </Button>
            <Button onClick={cancelMigration} disabled={cancelling || resuming}>
              {cancelling ? "Cancelling..." : "Cancel migration"}
            </Button>
          </div>
        </Card>
      ) : null}

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

        {hasCurrentFileProgress ? (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-500">Current file transfer</span>
              <span className="font-medium text-slate-700">
                {formatBytes(progress.currentFileUploadedBytes)} / {formatBytes(progress.currentFileTotalBytes)} · {currentFilePercentage}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-blue-600" style={{ width: `${currentFilePercentage}%` }} />
            </div>
          </div>
        ) : null}
      </Card>

      {progress.failedItems?.length ? (
        <Card>
          <div className="mb-4">
            <h3 className="font-semibold text-slate-950">Failed files</h3>
            <p className="text-sm text-slate-600">Showing the latest {progress.failedItems.length} failures and why they stopped.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {progress.failedItems.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-950">{item.name}</p>
                    <p className="truncate text-xs text-slate-500">{item.path}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{item.retryCount} attempt{item.retryCount === 1 ? "" : "s"}</span>
                </div>
                {item.error ? <p className="mt-2 text-sm text-red-700">{item.error}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {progress.status === "failed" && progress.failedFiles > 0 ? (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">Some files did not transfer.</h3>
            <p className="text-sm text-slate-600">
              {reauthRequired
                ? "Reconnect Google Drive first, then retry only the failed files."
                : "Retry only the failed files without rebuilding the migration."}
            </p>
          </div>
          <Button onClick={retryFailedFiles} disabled={retrying || reauthRequired}>
            {retrying ? "Retrying..." : `Retry ${progress.failedFiles} failed`}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
