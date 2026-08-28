"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  File,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  Square,
  Timer,
  XCircle,
} from "lucide-react";
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

function statusPresentation(status?: string) {
  switch (status) {
    case "completed":
      return { icon: CheckCircle2, label: "Completed", className: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/20" };
    case "failed":
      return { icon: XCircle, label: "Failed", className: "bg-red-400/15 text-red-200 ring-red-300/20" };
    case "paused":
      return { icon: Pause, label: "Paused", className: "bg-amber-400/15 text-amber-100 ring-amber-300/20" };
    case "cancelled":
      return { icon: Square, label: "Cancelled", className: "bg-slate-400/15 text-slate-200 ring-slate-300/20" };
    case "scanning":
      return { icon: RefreshCcw, label: "Scanning", className: "bg-cyan-400/15 text-cyan-100 ring-cyan-300/20" };
    case "running":
      return { icon: Activity, label: "Running", className: "bg-blue-400/15 text-blue-100 ring-blue-300/20" };
    default:
      return { icon: Clock3, label: "Pending", className: "bg-white/10 text-slate-200 ring-white/10" };
  }
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
    return (
      <Card className="border-red-200 bg-red-50">
        <div className="flex items-start gap-3 text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-bold">Unable to load migration</h2>
            <p className="mt-1 text-sm leading-6">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (!progress) {
    return (
      <Card className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" />
        <span className="text-sm font-semibold text-slate-700">Loading migration progress...</span>
      </Card>
    );
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
  const status = statusPresentation(progress.status);
  const StatusIcon = status.icon;
  const overallPercentage = Math.min(progress.percentage, 100);

  return (
    <div className="space-y-5">
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {progress.errorMessage ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{progress.errorMessage}</span>
        </div>
      ) : null}

      {reauthRequired ? (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-black text-slate-950">Google Drive needs to be reconnected</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">
                  Your migration record is safe. Reconnect Google Drive, return here, then retry the failed transfer.
                </p>
              </div>
            </div>
            <GoogleReconnectLink redirectTo={`/migrations/${migrationId}`} />
          </div>
        </Card>
      ) : null}

      <Card className="relative overflow-hidden border-slate-900 bg-slate-950 p-0 text-white shadow-[0_30px_80px_-44px_rgba(15,23,42,0.85)]">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-28 left-20 h-52 w-52 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative p-6 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${status.className}`}>
                <StatusIcon className={`h-3.5 w-3.5 ${progress.status === "scanning" ? "animate-spin" : ""}`} />
                {status.label}
              </span>
              <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                {progress.status === "completed" ? "Migration complete" : progress.status === "failed" ? "Migration needs attention" : "Migration in progress"}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                GDM refreshes this page automatically every few seconds while the worker processes your folder.
              </p>
            </div>
            <div className="sm:text-right">
              <strong className="block text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">{overallPercentage}%</strong>
              <span className="mt-1 block text-xs font-medium uppercase tracking-[0.13em] text-slate-500">Overall progress</span>
            </div>
          </div>

          <div className="mt-7 h-3 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-[width] duration-500"
              style={{ width: `${overallPercentage}%` }}
            />
          </div>

          {progress.status === "running" ? (
            <div className="mt-6 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  <Gauge className="h-4 w-4 text-cyan-300" /> Transfer speed
                </div>
                <p className="mt-2 text-lg font-black text-white">
                  {transferRate ? `${formatBytes(transferRate)}/s` : "Calculating..."}
                </p>
              </div>
              <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  <Timer className="h-4 w-4 text-emerald-300" /> Estimated time
                </div>
                <p className="mt-2 text-lg font-black text-white">
                  {etaLabel ?? (transferRate ? "Finishing..." : "Waiting for activity...")}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {active ? (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-black text-slate-950">Migration controls</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Pause preserves resumable upload progress. Cancel permanently stops this migration.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={pauseMigration} disabled={pausing || cancelling}>
              {pausing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              {pausing ? "Pausing..." : "Pause"}
            </Button>
            <Button variant="danger" onClick={cancelMigration} disabled={cancelling || pausing}>
              {cancelling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          </div>
        </Card>
      ) : null}

      {progress.status === "paused" ? (
        <Card className="flex flex-col gap-4 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-amber-700"><Pause className="h-4 w-4" /> Paused safely</div>
            <h3 className="font-black text-slate-950">Pick up where you left off</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Completed files stay complete and large-file resumable sessions keep their confirmed byte position.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={resumeMigration} disabled={resuming || cancelling}>
              {resuming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {resuming ? "Resuming..." : "Resume"}
            </Button>
            <Button variant="danger" onClick={cancelMigration} disabled={cancelling || resuming}>
              {cancelling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              {cancelling ? "Cancelling..." : "Cancel"}
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Completed</p>
              <strong className="mt-2 block text-3xl font-black text-slate-950">{progress.completedFiles.toLocaleString()}</strong>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></span>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Failed</p>
              <strong className="mt-2 block text-3xl font-black text-slate-950">{progress.failedFiles.toLocaleString()}</strong>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-red-50 text-red-600"><XCircle className="h-5 w-5" /></span>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Total files</p>
              <strong className="mt-2 block text-3xl font-black text-slate-950">{progress.totalFiles.toLocaleString()}</strong>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600"><File className="h-5 w-5" /></span>
          </div>
        </Card>
      </section>

      <Card>
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-50 text-cyan-600"><Activity className="h-5 w-5" /></span>
          <div>
            <h3 className="font-black text-slate-950">Current transfer</h3>
            <p className="text-xs text-slate-500">Live worker activity and copied data.</p>
          </div>
        </div>

        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Current file</dt>
            <dd className="mt-2 truncate font-bold text-slate-950">{progress.currentFile ?? "Waiting for next file"}</dd>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Data copied</dt>
            <dd className="mt-2 font-bold text-slate-950">{formatBytes(progress.copiedBytes)} <span className="font-medium text-slate-400">/ {formatBytes(progress.totalBytes)}</span></dd>
          </div>
        </dl>

        {hasCurrentFileProgress ? (
          <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="font-bold text-blue-950">Current file progress</span>
              <span className="text-xs font-medium text-blue-700">
                {formatBytes(progress.currentFileUploadedBytes)} / {formatBytes(progress.currentFileTotalBytes)} · {currentFilePercentage}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 transition-[width] duration-500" style={{ width: `${currentFilePercentage}%` }} />
            </div>
          </div>
        ) : null}
      </Card>

      {progress.failedItems?.length ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-red-50/60 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-red-600 shadow-sm"><AlertTriangle className="h-4 w-4" /></span>
              <div>
                <h3 className="font-black text-slate-950">Failed files</h3>
                <p className="text-xs text-slate-500">Latest {progress.failedItems.length} failures and the reason each one stopped.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {progress.failedItems.map((item) => (
              <div key={item.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-950">{item.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{item.path}</p>
                    {item.error ? <p className="mt-2 text-sm leading-6 text-red-700">{item.error}</p> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                    {item.retryCount} attempt{item.retryCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {progress.status === "failed" && progress.failedFiles > 0 ? (
        <Card className="flex flex-col gap-4 border-red-200 bg-gradient-to-br from-red-50 to-orange-50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.13em] text-red-700"><RotateCcw className="h-4 w-4" /> Recovery</div>
            <h3 className="font-black text-slate-950">Retry only what failed</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {reauthRequired
                ? "Reconnect Google Drive first, then retry the failed files."
                : "Completed files stay untouched. GDM will only queue the failed items again."}
            </p>
          </div>
          <Button onClick={retryFailedFiles} disabled={retrying || reauthRequired}>
            {retrying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {retrying ? "Retrying..." : `Retry ${progress.failedFiles} failed`}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
