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
  const metrics = [
    { label: "Total Users", value: totalUsers.toLocaleString() },
    { label: "Total Migrations", value: totalMigrations.toLocaleString() },
    { label: "Active Migrations", value: activeMigrations.toLocaleString() },
    { label: "Failed Migrations", value: failedMigrations.toLocaleString() },
    { label: "Files Migrated", value: (totals?.totalFilesMigrated ?? 0).toLocaleString() },
    { label: "Data Transferred", value: formatBytes(totals?.totalDataTransferred ?? 0) },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Operational view for migrations, users, workers, and BullMQ health.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${queueHealth.online ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            Redis queues {queueHealth.online ? "online" : "unavailable"}
          </span>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${queueHealth.workerOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            Worker {queueHealth.workerOnline ? "online" : "heartbeat missing"}
          </span>
        </div>
      </div>

      {workerBacklogAlert ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong className="block text-red-950">Worker outage with queued work</strong>
          <span>{queuedWork.toLocaleString()} queued/active/delayed jobs are present but no fresh worker heartbeat exists. Check the worker deployment before the backlog grows.</span>
        </div>
      ) : null}

      {failedQueueJobs > 0 ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="block">Failed BullMQ jobs need attention</strong>
          <span>{failedQueueJobs.toLocaleString()} failed jobs remain across the migration queues. Review the queue table and related migration failures.</span>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <p className="text-sm text-slate-500">{metric.label}</p>
            <strong className="mt-1 block text-3xl text-slate-950">{metric.value}</strong>
          </Card>
        ))}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Queue health</h2>
            <p className="text-sm text-slate-600">Waiting, active, delayed, and failed jobs by worker queue.</p>
          </div>
          {queueHealth.workerHeartbeatAt ? (
            <p className="text-xs text-slate-500">Last worker heartbeat: {new Date(queueHealth.workerHeartbeatAt).toLocaleString()}</p>
          ) : null}
        </div>

        {queueHealth.online ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="hidden grid-cols-5 gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-medium uppercase text-slate-500 sm:grid">
              <span>Queue</span><span>Waiting</span><span>Active</span><span>Delayed</span><span>Failed</span>
            </div>
            {queueHealth.queues.map((queue) => (
              <div key={queue.name} className="grid gap-2 border-b border-slate-100 px-4 py-4 text-sm last:border-b-0 sm:grid-cols-5 sm:gap-3">
                <strong className="text-slate-950">{queue.name}</strong>
                <span><span className="text-slate-500 sm:hidden">Waiting: </span>{queue.waiting}</span>
                <span><span className="text-slate-500 sm:hidden">Active: </span>{queue.active}</span>
                <span><span className="text-slate-500 sm:hidden">Delayed: </span>{queue.delayed}</span>
                <span className={queue.failed > 0 ? "font-medium text-red-700" : "text-slate-700"}>
                  <span className="text-slate-500 sm:hidden">Failed: </span>{queue.failed}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-sm text-red-700">Redis could not be reached, so queue and worker metrics are unavailable.</p>
          </Card>
        )}
      </section>
    </main>
  );
}
