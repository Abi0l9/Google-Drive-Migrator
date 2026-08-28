import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Files,
  HardDrive,
  History,
  PauseCircle,
  Plus,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { env, isAdminEmail, isGoogleOAuthConfigured } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { usagePeriodFor } from "@/lib/migration/quota";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface DashboardMigration {
  _id: { toString(): string };
  sourceFolderName: string;
  status: string;
  destinationRootFolderId?: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  createdAt?: Date;
}

interface DashboardUsage {
  bytes: number;
  files: number;
}

function statusStyle(status: string) {
  switch (status) {
    case "completed":
      return { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
    case "failed":
      return { icon: XCircle, className: "bg-red-50 text-red-700 ring-red-100" };
    case "paused":
      return { icon: PauseCircle, className: "bg-amber-50 text-amber-700 ring-amber-100" };
    case "cancelled":
      return { icon: XCircle, className: "bg-slate-100 text-slate-600 ring-slate-200" };
    default:
      return { icon: Clock3, className: "bg-blue-50 text-blue-700 ring-blue-100" };
  }
}

export default async function DashboardPage() {
  const session = await auth();
  const email = session?.user?.email;
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  let migrations: DashboardMigration[] = [];
  let monthlyUsage: DashboardUsage = { bytes: 0, files: 0 };

  if (email) {
    await connectDb();
    const user = await User.findOne({ email }).select("_id").lean<{ _id: unknown }>();
    if (user) {
      const [recentMigrations, usageRows] = await Promise.all([
        Migration.find({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean<DashboardMigration[]>(),
        Migration.aggregate<DashboardUsage>([
          { $match: { userId: user._id, quotaPeriod: usagePeriodFor() } },
          {
            $group: {
              _id: null,
              bytes: { $sum: "$quotaChargedBytes" },
              files: { $sum: "$quotaChargedFiles" },
            },
          },
        ]),
      ]);

      migrations = recentMigrations;
      monthlyUsage = {
        bytes: usageRows[0]?.bytes ?? 0,
        files: usageRows[0]?.files ?? 0,
      };
    }
  }

  const completed = migrations.reduce((sum, migration) => sum + (migration.completedFiles ?? 0), 0);
  const failed = migrations.reduce((sum, migration) => sum + (migration.failedFiles ?? 0), 0);
  const byteUsagePercent = Math.min(
    100,
    Math.round((monthlyUsage.bytes / Math.max(1, env.maxMonthlyTransferBytesPerUser)) * 100),
  );
  const fileUsagePercent = Math.min(
    100,
    Math.round((monthlyUsage.files / Math.max(1, env.maxMonthlyTransferFilesPerUser)) * 100),
  );

  return (
    <>
      <SiteHeader email={email} authConfigured={googleOAuthConfigured} isAdmin={isAdminEmail(email)} />

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-6 lg:px-8 lg:pt-14">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] text-blue-700">
              <History className="h-3.5 w-3.5" />
              Migration workspace
            </div>
            <h1 className="text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">Your migration dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Track recent transfers, monthly usage, and jump straight back into any migration that needs attention.
            </p>
          </div>
          {email ? (
            <Link
              href="/#migrate"
              className="inline-flex w-fit items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-[0_14px_28px_-18px_rgba(15,23,42,0.75)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              New migration
            </Link>
          ) : null}
        </div>

        {!email ? (
          <Card className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <History className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-xl font-black text-slate-950">Sign in to see your migration history</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              Your dashboard is tied to the Google account you authorize for destination transfers.
            </p>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="relative overflow-hidden">
                <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-blue-100/60 blur-2xl" />
                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Recent migrations</p>
                    <strong className="mt-2 block text-3xl font-black tracking-tight text-slate-950">{migrations.length}</strong>
                    <span className="mt-1 block text-xs text-slate-500">Latest 10 shown below</span>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600"><History className="h-5 w-5" /></span>
                </div>
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Completed files</p>
                    <strong className="mt-2 block text-3xl font-black tracking-tight text-slate-950">{completed.toLocaleString()}</strong>
                    <span className="mt-1 block text-xs text-slate-500">Across recent migrations</span>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Files className="h-5 w-5" /></span>
                </div>
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Failed files</p>
                    <strong className="mt-2 block text-3xl font-black tracking-tight text-slate-950">{failed.toLocaleString()}</strong>
                    <span className="mt-1 block text-xs text-slate-500">Retryable from migration details</span>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-50 text-amber-600"><TriangleAlert className="h-5 w-5" /></span>
                </div>
              </Card>

              <Card className="bg-slate-950 text-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-400">Monthly data</p>
                    <strong className="mt-2 block truncate text-xl font-black tracking-tight">
                      {formatBytes(monthlyUsage.bytes)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-400">of {formatBytes(env.maxMonthlyTransferBytesPerUser)}</span>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-cyan-300"><HardDrive className="h-5 w-5" /></span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${byteUsagePercent}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                  <span>{byteUsagePercent}% data</span>
                  <span>{fileUsagePercent}% files</span>
                </div>
              </Card>
            </section>

            <Card className="mt-6 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Monthly allowance</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {monthlyUsage.files.toLocaleString()} of {env.maxMonthlyTransferFilesPerUser.toLocaleString()} files planned this UTC month
                  </p>
                </div>
                <div className="min-w-48 flex-1 sm:max-w-md">
                  <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>File allowance</span><span>{fileUsagePercent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${fileUsagePercent}%` }} />
                  </div>
                </div>
              </div>
            </Card>

            <section className="mt-10">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950">Recent migrations</h2>
                  <p className="mt-1 text-sm text-slate-500">The newest activity for this Google account.</p>
                </div>
              </div>

              {migrations.length ? (
                <Card className="overflow-hidden p-0">
                  <div className="hidden grid-cols-[minmax(0,1.5fr)_0.7fr_0.8fr_0.7fr_auto] gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.13em] text-slate-500 lg:grid">
                    <span>Folder</span><span>Status</span><span>Progress</span><span>Created</span><span>Action</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {migrations.map((migration) => {
                      const migrationId = migration._id.toString();
                      const destinationDriveUrl = migration.destinationRootFolderId
                        ? `https://drive.google.com/drive/folders/${encodeURIComponent(migration.destinationRootFolderId)}`
                        : null;
                      const tone = statusStyle(migration.status);
                      const StatusIcon = tone.icon;
                      const createdLabel = migration.createdAt
                        ? new Date(migration.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                        : "—";
                      const totalFiles = migration.totalFiles ?? 0;
                      const completedFiles = migration.completedFiles ?? 0;
                      const progressPercent = totalFiles > 0 ? Math.min(100, Math.round((completedFiles / totalFiles) * 100)) : 0;

                      return (
                        <div
                          key={migrationId}
                          className="grid gap-4 px-5 py-5 transition hover:bg-blue-50/30 lg:grid-cols-[minmax(0,1.5fr)_0.7fr_0.8fr_0.7fr_auto] lg:items-center"
                        >
                          <div className="min-w-0">
                            <Link href={`/migrations/${migrationId}`} className="group inline-flex max-w-full items-center gap-2 font-bold text-slate-950 hover:text-blue-700">
                              <span className="truncate">{migration.sourceFolderName}</span>
                              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                            </Link>
                            <p className="mt-1 text-xs text-slate-500 lg:hidden">Created {createdLabel}</p>
                          </div>

                          <div>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold capitalize ring-1 ring-inset ${tone.className}`}>
                              <StatusIcon className="h-3.5 w-3.5" />
                              {migration.status}
                            </span>
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
                              <span>{completedFiles.toLocaleString()} / {totalFiles.toLocaleString()}</span>
                              <span>{progressPercent}%</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>

                          <span className="hidden text-sm text-slate-500 lg:block">{createdLabel}</span>

                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <Link href={`/migrations/${migrationId}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:text-blue-700">
                              Details
                            </Link>
                            {destinationDriveUrl ? (
                              <a
                                href={destinationDriveUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                              >
                                Drive <ArrowUpRight className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ) : (
                <Card className="border-dashed text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                    <History className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-bold text-slate-950">No migrations yet</h3>
                  <p className="mt-1 text-sm text-slate-500">Your first transfer will appear here as soon as it starts.</p>
                  <Link href="/#migrate" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-800">
                    Start one now <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Card>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
