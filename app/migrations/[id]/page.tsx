import { isValidObjectId } from "mongoose";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-actions";
import { ProgressPanel } from "@/components/progress-panel";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { isGoogleOAuthConfigured } from "@/lib/env";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface MigrationPageProps {
  params: Promise<{ id: string }>;
}

const reportStatuses = new Set(["completed", "failed", "cancelled"]);

export default async function MigrationPage({ params }: MigrationPageProps) {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  const { id } = await params;
  let reportAvailable = false;

  if (session?.user?.email && isValidObjectId(id)) {
    await connectDb();
    const user = await User.findOne({ email: session.user.email }).select("_id").lean<{ _id: unknown }>();
    if (user) {
      const migration = await Migration.findOne({ _id: id, userId: user._id }).select("status").lean<{ status?: string }>();
      reportAvailable = Boolean(migration?.status && reportStatuses.has(migration.status));
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold uppercase tracking-[0.2em] text-blue-600">Migration</p>
          <h1 className="text-3xl font-bold text-slate-950">Progress</h1>
        </div>
        {!session?.user?.email ? <SignInButton disabled={!googleOAuthConfigured} /> : null}
      </div>

      {session?.user?.email ? (
        <div className="space-y-5">
          <ProgressPanel migrationId={id} />
          {reportAvailable ? (
            <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">Migration report</h2>
                <p className="text-sm text-slate-600">Download the complete file-by-file result for records or troubleshooting.</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm font-medium">
                <a
                  href={`/api/migrations/${id}/report?format=csv`}
                  className="rounded-xl bg-slate-950 px-4 py-2.5 text-white hover:bg-slate-800"
                >
                  Download CSV
                </a>
                <a
                  href={`/api/migrations/${id}/report?format=json`}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-800 hover:bg-slate-50"
                >
                  Download JSON
                </a>
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <p className="text-slate-600">Sign in to view this migration.</p>
      )}
    </main>
  );
}
