import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-actions";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { env, isGoogleOAuthConfigured } from "@/lib/env";
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

export default async function DashboardPage() {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  let migrations: DashboardMigration[] = [];
  let monthlyUsage: DashboardUsage = { bytes: 0, files: 0 };

  if (session?.user?.email) {
    await connectDb();
    const user = await User.findOne({ email: session.user.email }).select("_id").lean<{ _id: unknown }>();
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">GDM</p>
          <h1 className="mb-2 text-3xl font-bold">Migration Dashboard</h1>
          <p className="text-slate-600">Signed in as {session?.user?.email ?? "guest"}.</p>
        </div>
        {!session?.user?.email ? <SignInButton disabled={!googleOAuthConfigured} /> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card><p className="text-sm text-slate-500">Migrations</p><strong className="text-3xl">{migrations.length}</strong></Card>
        <Card><p className="text-sm text-slate-500">Completed Files</p><strong className="text-3xl">{completed}</strong></Card>
        <Card><p className="text-sm text-slate-500">Failed Files</p><strong className="text-3xl">{failed}</strong></Card>
        <Card>
          <p className="text-sm text-slate-500">Monthly Allowance</p>
          <strong className="block text-lg text-slate-950">
            {formatBytes(monthlyUsage.bytes)} / {formatBytes(env.maxMonthlyTransferBytesPerUser)}
          </strong>
          <span className="text-xs text-slate-500">
            {monthlyUsage.files.toLocaleString()} / {env.maxMonthlyTransferFilesPerUser.toLocaleString()} files · resets UTC monthly
          </span>
        </Card>
      </div>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-slate-950">Recent Migrations</h2>
        {migrations.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {migrations.map((migration) => {
              const migrationId = migration._id.toString();
              const destinationDriveUrl = migration.destinationRootFolderId
                ? `https://drive.google.com/drive/folders/${encodeURIComponent(migration.destinationRootFolderId)}`
                : null;

              return (
                <div
                  key={migrationId}
                  className="grid gap-3 border-b border-slate-100 p-4 text-sm last:border-b-0 hover:bg-slate-50 md:grid-cols-[1fr_auto_auto_auto] md:items-center"
                >
                  <a href={`/migrations/${migrationId}`} className="font-medium text-slate-950 hover:text-blue-700">
                    {migration.sourceFolderName}
                  </a>
                  <span className="capitalize text-slate-600">{migration.status}</span>
                  <span className="text-slate-500">{migration.completedFiles ?? 0}/{migration.totalFiles ?? 0} files</span>
                  {destinationDriveUrl ? (
                    <a
                      href={destinationDriveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:border-blue-200 hover:text-blue-700"
                    >
                      Open in Drive ↗
                    </a>
                  ) : (
                    <a href={`/migrations/${migrationId}`} className="font-medium text-blue-700 hover:text-blue-800">
                      View progress
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Card><p className="text-sm text-slate-600">No migrations yet.</p></Card>
        )}
      </section>
    </main>
  );
}
