import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card } from "@/components/ui";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { getRuntimeActivity, getTodayUsage } from "@/lib/cloudflare/d1";
import { formatBytes } from "@/lib/format";

const ACTIVE_STATUSES = "'pending','scanning','running','paused'";

export default async function AdminPage() {
  const session = await auth();
  const cloudflare = getGdmCloudflareEnv();
  const adminEmails = (cloudflare.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!session?.user?.email || !adminEmails.includes(session.user.email.toLowerCase())) redirect("/");

  const [
    users,
    migrations,
    active,
    failed,
    totals,
    actionableItems,
    failedItems,
    usage,
    lastBatch,
    lastSuccess,
    workerFreshness,
  ] = await Promise.all([
    cloudflare.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    cloudflare.DB.prepare("SELECT COUNT(*) AS count FROM migrations").first<{ count: number }>(),
    cloudflare.DB.prepare(`SELECT COUNT(*) AS count FROM migrations WHERE status IN (${ACTIVE_STATUSES})`).first<{ count: number }>(),
    cloudflare.DB.prepare("SELECT COUNT(*) AS count FROM migrations WHERE status = 'failed'").first<{ count: number }>(),
    cloudflare.DB.prepare(`
      SELECT COALESCE(SUM(completed_files), 0) AS files, COALESCE(SUM(copied_bytes), 0) AS bytes
      FROM migrations
    `).first<{ files: number; bytes: number }>(),
    cloudflare.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM migration_items i
      JOIN migrations m ON m.id = i.migration_id
      WHERE m.status IN ('scanning','running') AND i.status IN ('pending','copying')
    `).first<{ count: number }>(),
    cloudflare.DB.prepare("SELECT COUNT(*) AS count FROM migration_items WHERE item_type = 'file' AND status = 'failed'")
      .first<{ count: number }>(),
    getTodayUsage(cloudflare.DB),
    getRuntimeActivity(cloudflare.DB, "jobs:last_batch"),
    getRuntimeActivity(cloudflare.DB, "jobs:last_success"),
    cloudflare.DB.prepare(`
      SELECT EXISTS(
        SELECT 1
        FROM runtime_activity
        WHERE key = 'jobs:last_batch'
          AND datetime(updated_at) >= datetime('now', '-5 minutes')
      ) AS active
    `).first<{ active: number }>(),
  ]);

  const queueBudget = Math.max(1, Number(cloudflare.GDM_DAILY_QUEUE_MESSAGE_BUDGET ?? 2200) || 2200);
  const queueUsed = usage?.queueMessages ?? 0;
  const backlog = actionableItems?.count ?? 0;
  const lastBatchAt = lastBatch?.updatedAt ?? null;
  const workerRecentlyActive = Boolean(workerFreshness?.active);
  const workerBacklogAlert = backlog > 0 && !workerRecentlyActive;

  const metrics = [
    { label: "Total Users", value: (users?.count ?? 0).toLocaleString() },
    { label: "Total Migrations", value: (migrations?.count ?? 0).toLocaleString() },
    { label: "Active Migrations", value: (active?.count ?? 0).toLocaleString() },
    { label: "Failed Migrations", value: (failed?.count ?? 0).toLocaleString() },
    { label: "Files Migrated", value: (totals?.files ?? 0).toLocaleString() },
    { label: "Data Transferred", value: formatBytes(totals?.bytes ?? 0) },
  ];

  const runtimeRows = [
    { label: "Actionable work items", value: backlog.toLocaleString() },
    { label: "Failed file items", value: (failedItems?.count ?? 0).toLocaleString() },
    { label: "Queue messages reserved today", value: `${queueUsed.toLocaleString()} / ${queueBudget.toLocaleString()}` },
    { label: "Queue budget remaining", value: Math.max(0, queueBudget - queueUsed).toLocaleString() },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Operational view for the Cloudflare Workers, D1, and Queue migration runtime.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">D1 online</span>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${backlog === 0 || workerRecentlyActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            Queue consumer {backlog === 0 ? "idle" : workerRecentlyActive ? "active" : "activity stale"}
          </span>
          <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">Zero-cost mode</span>
        </div>
      </div>

      {workerBacklogAlert ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong className="block text-red-950">Queue consumer may need attention</strong>
          <span>{backlog.toLocaleString()} actionable items remain, but no Queue batch has been observed in the last five minutes.</span>
        </div>
      ) : null}

      {(failedItems?.count ?? 0) > 0 ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="block">Failed migration items need attention</strong>
          <span>{(failedItems?.count ?? 0).toLocaleString()} file items are currently marked failed and can be retried from their migrations.</span>
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
        <div className="mb-3">
          <h2 className="text-xl font-semibold text-slate-950">Cloudflare runtime</h2>
          <p className="text-sm text-slate-600">D1 workload state and the application-enforced free Queue budget.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {runtimeRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-4 text-sm last:border-b-0">
              <span className="text-slate-600">{row.label}</span>
              <strong className="text-slate-950">{row.value}</strong>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <p>Last Queue batch: {lastBatchAt ? new Date(lastBatchAt).toLocaleString() : "No work processed yet"}</p>
          <p>Last successful Queue job: {lastSuccess?.updatedAt ? new Date(lastSuccess.updatedAt).toLocaleString() : "No completed job observed yet"}</p>
        </div>
      </section>
    </main>
  );
}
