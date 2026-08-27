import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-actions";
import { Card } from "@/components/ui";
import { getGdmCloudflareEnv } from "@/lib/cloudflare/context";
import { listMigrationsForUser, getUserByEmail } from "@/lib/cloudflare/d1";

export default async function DashboardPage() {
  const session = await auth();
  const cloudflare = getGdmCloudflareEnv();
  const googleOAuthConfigured =
    cloudflare.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com") &&
    Boolean(cloudflare.GOOGLE_CLIENT_SECRET);
  let migrations = [] as Awaited<ReturnType<typeof listMigrationsForUser>>;

  if (session?.user?.email) {
    const user = await getUserByEmail(cloudflare.DB, session.user.email);
    if (user) migrations = await listMigrationsForUser(cloudflare.DB, user.id, 10);
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
                key={migration.id}
                href={`/migrations/${migration.id}`}
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
