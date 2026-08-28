import {
  Activity,
  AlertTriangle,
  Database,
  FileCheck2,
  HardDrive,
  ServerCog,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import {
  getMigrationWorkerHeartbeat,
  getReportQueue,
  getRetryQueue,
  getScanQueue,
  getTransferQueue,
} from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface MigrationTotals {
  totalFilesMigrated?: number;
  totalDataTransferred?: number;
}

interface QueueSnapshot {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

interface QueueHealth {
  online: boolean;
  workerOnline: boolean;
  workerHeartbeatAt?: string;
  queues: QueueSnapshot[];
}

const activeStatuses = ["pending", "scanning", "running", "paused"];

async function loadQueueHealth(): Promise<QueueHealth> {
  const queueEntries = [
    ["Scan", getScanQueue()],
    ["Transfer", getTransferQueue()],
    ["Retry / resume", getRetryQueue()],
    ["Report", getReportQueue()],
  ] as const;

  try {
    const [queues, workerHeartbeatAt] = await Promise.all([
      Promise.all(queueEntries.map(async ([name, queue]) => {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
        };
      })),
      getMigrationWorkerHeartbeat(),
    ]);

    return {
      online: true,
      workerOnline: Boolean(workerHeartbeatAt),
      workerHeartbeatAt: workerHeartbeatAt ?? undefined,
      queues,
    };
  } catch {
    return { online: false, workerOnline: false, queues: [] };
  }
}

export default async function AdminPage() {
  await connectDb();

  const [totalUsers, totalMigrations, activeMigrations, failedMigrations, totalsResult, queueHealth] = await Promise.all([
    User.countDocuments(),
    Migration.countDocuments(),
    Migration.countDocuments({ status: { $in: activeStatuses } }),
    Migration.countDocuments({ status: "failed" }),
    Migration.aggregate<MigrationTotals>([
      {
        $group: {
          _id: null,
          totalFilesMigrated: { $sum: "$completedFiles" },
          totalDataTransferred: { $sum: "$copiedBytes" },
        },
      },
    ]),
    loadQueueHealth(),
  ]);

  const totals = totalsResult[0];
  const queuedWork = queueHealth.queues.reduce((sum, queue) => sum + queue.waiting + queue.active + queue.delayed, 0);
  const failedQueueJobs = queueHealth.queues.reduce((sum, queue) => sum + queue.failed, 0);
  const workerBacklogAlert = queueHealth.online && !queueHealth.workerOnline && queuedWork > 0;
  const systemHealthy = queueHealth.online && queueHealth.workerOnline && failedQueueJobs === 0;

  const metrics = [
    { label: "Total users", value: totalUsers.toLocaleString(), icon: Users, tone: "bg-blue-50 text-blue-600" },
    { label: "Total migrations", value: totalMigrations.toLocaleString(), icon: Workflow, tone: "bg-cyan-50 text-cyan-600" },
    { label: "Active migrations", value: activeMigrations.toLocaleString(), icon: Activity, tone: "bg-emerald-50 text-emerald-600" },
    { label: "Failed migrations", value: failedMigrations.toLocaleString(), icon: XCircle, tone: "bg-red-50 text-red-600" },
    { label: "Files migrated", value: (totals?.totalFilesMigrated ?? 0).toLocaleString(), icon: FileCheck2, tone: "bg-violet-50 text-violet-600" },
    { label: "Data transferred", value: formatBytes(totals?.totalDataTransferred ?? 0), icon: HardDrive, tone: "bg-amber-50 text-amber-600" },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-6 lg:px-8 lg:pt-14">
      <section className="relative mb-8 overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 p-6 text-white shadow-[0_30px_80px_-44px_rgba(15,23,42,0.9)] sm:p-8">
        <div className="absolute -right-20 -top-28 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute -bottom-28 left-32 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 ring-1 ring-white/10">
              <ServerCog className="h-3.5 w-3.5" />
              Operations control
            </div>
            <h1 className="text-3xl font-black tracking-[-0.03em] sm:text-4xl">Admin dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              Live visibility into migration activity, Redis queues, worker heartbeat, user growth, and transfer volume.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
            <div className={`rounded-2xl p-4 ring-1 ring-inset ${queueHealth.online ? "bg-emerald-400/10 text-emerald-100 ring-emerald-300/20" : "bg-red-400/10 text-red-100 ring-red-300/20"}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
                <Database className="h-4 w-4" /> Redis queues
              </div>
              <strong className="mt-2 block text-lg">{queueHealth.online ? "Online" : "Unavailable"}</strong>
            </div>
            <div className={`rounded-2xl p-4 ring-1 ring-inset ${queueHealth.workerOnline ? "bg-emerald-400/10 text-emerald-100 ring-emerald-300/20" : "bg-amber-400/10 text-amber-100 ring-amber-300/20"}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]">
                <Activity className="h-4 w-4" /> Worker
              </div>
              <strong className="mt-2 block text-lg">{queueHealth.workerOnline ? "Heartbeat live" : "Heartbeat missing"}</strong>
            </div>
          </div>
        </div>
      </section>

      {workerBacklogAlert ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong className="block font-black text-red-950">Worker outage with queued work</strong>
            <span className="mt-1 block leading-6">{queuedWork.toLocaleString()} queued, active, or delayed jobs exist without a fresh worker heartbeat. Check the worker deployment before the backlog grows.</span>
          </div>
        </div>
      ) : null}

      {failedQueueJobs > 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong className="block font-black">Failed BullMQ jobs need attention</strong>
            <span className="mt-1 block leading-6">{failedQueueJobs.toLocaleString()} failed jobs remain across migration queues. Review queue health and related migration failures.</span>
          </div>
        </div>
      ) : null}

      {systemHealthy ? (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-800">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" />
          All monitored systems are healthy right now.
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">{metric.label}</p>
                <strong className="mt-2 block text-3xl font-black tracking-tight text-slate-950">{metric.value}</strong>
              </div>
              <span className={`grid h-11 w-11 place-items-center rounded-2xl ${metric.tone}`}>
                <metric.icon className="h-5 w-5" />
              </span>
            </div>
          </Card>
        ))}
      </section>

      <section className="mt-10">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
              <Workflow className="h-4 w-4" /> Queue telemetry
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">Worker queue health</h2>
            <p className="mt-1 text-sm text-slate-500">Waiting, active, delayed, and failed jobs across the migration pipeline.</p>
          </div>
          {queueHealth.workerHeartbeatAt ? (
            <p className="text-xs font-medium text-slate-500">Last worker heartbeat: {new Date(queueHealth.workerHeartbeatAt).toLocaleString()}</p>
          ) : null}
        </div>

        {queueHealth.online ? (
          <Card className="overflow-hidden p-0">
            <div className="hidden grid-cols-[1.2fr_repeat(4,0.7fr)] gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.13em] text-slate-500 sm:grid">
              <span>Queue</span><span>Waiting</span><span>Active</span><span>Delayed</span><span>Failed</span>
            </div>
            <div className="divide-y divide-slate-100">
              {queueHealth.queues.map((queue) => (
                <div key={queue.name} className="grid gap-3 px-5 py-5 text-sm sm:grid-cols-[1.2fr_repeat(4,0.7fr)] sm:items-center sm:gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><Workflow className="h-4 w-4" /></span>
                    <strong className="text-slate-950">{queue.name}</strong>
                  </div>
                  <span><span className="font-medium text-slate-500 sm:hidden">Waiting: </span><strong className="text-slate-800">{queue.waiting}</strong></span>
                  <span><span className="font-medium text-slate-500 sm:hidden">Active: </span><strong className="text-slate-800">{queue.active}</strong></span>
                  <span><span className="font-medium text-slate-500 sm:hidden">Delayed: </span><strong className="text-slate-800">{queue.delayed}</strong></span>
                  <span className={queue.failed > 0 ? "font-black text-red-700" : "font-bold text-slate-500"}>
                    <span className="font-medium text-slate-500 sm:hidden">Failed: </span>{queue.failed}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="border-red-200 bg-red-50">
            <div className="flex items-start gap-3 text-red-800">
              <Database className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h3 className="font-black">Redis metrics unavailable</h3>
                <p className="mt-1 text-sm leading-6">Redis could not be reached, so queue and worker metrics cannot be loaded.</p>
              </div>
            </div>
          </Card>
        )}
      </section>
    </main>
  );
}
