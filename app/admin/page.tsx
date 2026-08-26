import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { isAdminEmail } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { getReportQueue, getRetryQueue, getScanQueue, getTransferQueue } from "@/lib/queue/migrations";
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

const activeStatuses = ["pending", "scanning", "running", "paused"];

async function loadQueueHealth(): Promise<{ online: boolean; queues: QueueSnapshot[] }> {
  const queueEntries = [
    ["Scan", getScanQueue()],
    ["Transfer", getTransferQueue()],
    ["Retry / resume", getRetryQueue()],
    ["Report", getReportQueue()],
  ] as const;

  try {
    const queues = await Promise.all(queueEntries.map(async ([name, queue]) => {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      return {
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      };
    }));
    return { online: true, queues };
  } catch {
    return { online: false, queues: [] };
  }
}

export default async function AdminPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) redirect("/");

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
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Operational view for migrations, users, and BullMQ health.</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${queueHealth.online ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          Redis queues {queueHealth.online ? "online" : "unavailable"}
        </span>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <p className="text-sm text-slate-500">{metric.label}</p>
            <strong className="mt-1 block text-3xl text-slate-950">{metric.value}</strong>
          </Card>
        ))}
      </section>

      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-slate-950">Queue health</h2>
          <p className="text-sm text-slate-600">Waiting, active, delayed, and failed jobs by worker queue.</p>
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
            <p className="text-sm text-red-700">Redis could not be reached, so queue metrics are unavailable.</p>
          </Card>
        )}
      </section>
    </main>
  );
}
