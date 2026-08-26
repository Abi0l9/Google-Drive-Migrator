import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-actions";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { isGoogleOAuthConfigured } from "@/lib/env";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface DashboardMigration {
  _id: { toString(): string };
  sourceFolderName: string;
  status: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  createdAt?: Date;
}

export default async function DashboardPage() {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  let migrations: DashboardMigration[] = [];

  if (session?.user?.email) {
    await connectDb();
    const user = await User.findOne({ email: session.user.email }).select("_id").lean<{ _id: unknown }>();
    if (user) {
      migrations = await Migration.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<DashboardMigration[]>();
    }
  }

  const completed = migrations.reduce((sum, migration) => sum + (migration.completedFiles ?? 0), 0);
  const failed = migrations.reduce((sum, migration) => sum + (migration.failedFiles ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="mb-2 text-3xl font-bold">Migration Dashboard</h1>
          <p className="text-slate-600">Signed in as {session?.user?.email ?? "guest"}.</p>
        </div>
        {!session?.user?.email ? <SignInButton disabled={!googleOAuthConfigured} /> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Migrations</p><strong className="text-3xl">{migrations.length}</strong></Card>
        <Card><p className="text-sm text-slate-500">Completed Files</p><strong className="text-3xl">{completed}</strong></Card>
        <Card><p className="text-sm text-slate-500">Failed Files</p><strong className="text-3xl">{failed}</strong></Card>
      </div>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold text-slate-950">Recent Migrations</h2>
        {migrations.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {migrations.map((migration) => (
              <a
                key={migration._id.toString()}
                href={`/migrations/${migration._id.toString()}`}
                className="grid gap-2 border-b border-slate-100 p-4 text-sm last:border-b-0 hover:bg-slate-50 md:grid-cols-[1fr_auto_auto]"
              >
                <span className="font-medium text-slate-950">{migration.sourceFolderName}</span>
                <span className="capitalize text-slate-600">{migration.status}</span>
                <span className="text-slate-500">{migration.completedFiles ?? 0}/{migration.totalFiles ?? 0} files</span>
              </a>
            ))}
          </div>
        ) : (
          <Card><p className="text-sm text-slate-600">No migrations yet.</p></Card>
        )}
      </section>
    </main>
  );
}
