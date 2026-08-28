import Link from "next/link";
import { ArrowLeft, ArrowUpRight, FileJson, FileSpreadsheet, FolderOpen, History } from "lucide-react";
import { isValidObjectId } from "mongoose";
import { auth } from "@/auth";
import { ProgressPanel } from "@/components/progress-panel";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { connectDb } from "@/lib/db";
import { isAdminEmail, isGoogleOAuthConfigured } from "@/lib/env";
import { Migration } from "@/models/migration";
import { User } from "@/models/user";

interface MigrationPageProps {
  params: Promise<{ id: string }>;
}

interface MigrationSummary {
  status?: string;
  destinationRootFolderId?: string;
  sourceFolderName?: string;
}

const reportStatuses = new Set(["completed", "failed", "cancelled"]);

export default async function MigrationPage({ params }: MigrationPageProps) {
  const session = await auth();
  const email = session?.user?.email;
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  const { id } = await params;
  let migrationSummary: MigrationSummary | null = null;

  if (email && isValidObjectId(id)) {
    await connectDb();
    const user = await User.findOne({ email }).select("_id").lean<{ _id: unknown }>();
    if (user) {
      migrationSummary = await Migration.findOne({ _id: id, userId: user._id })
        .select("status destinationRootFolderId sourceFolderName")
        .lean<MigrationSummary | null>();
    }
  }

  const reportAvailable = Boolean(
    migrationSummary?.status && reportStatuses.has(migrationSummary.status),
  );
  const destinationDriveUrl = migrationSummary?.destinationRootFolderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(migrationSummary.destinationRootFolderId)}`
    : null;

  return (
    <>
      <SiteHeader email={email} authConfigured={googleOAuthConfigured} isAdmin={isAdminEmail(email)} />

      <main className="mx-auto min-h-screen w-full max-w-6xl px-5 pb-16 pt-9 sm:px-6 lg:px-8 lg:pt-12">
        <div className="mb-7">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">
                <History className="h-3.5 w-3.5" />
                Migration detail
              </div>
              <h1 className="truncate text-3xl font-black tracking-[-0.03em] text-slate-950 sm:text-4xl">
                {migrationSummary?.sourceFolderName ?? "Migration progress"}
              </h1>
              <p className="mt-2 text-sm text-slate-500">Live transfer state, controls, failures, and destination access in one place.</p>
            </div>
          </div>
        </div>

        {email ? (
          <div className="space-y-6">
            <ProgressPanel migrationId={id} />

            {(destinationDriveUrl || reportAvailable) ? (
              <section className="grid gap-4 lg:grid-cols-2">
                {destinationDriveUrl ? (
                  <Card className="flex flex-col justify-between gap-5 bg-gradient-to-br from-blue-50/80 to-cyan-50/70">
                    <div>
                      <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                        <FolderOpen className="h-5 w-5" />
                      </div>
                      <h2 className="text-lg font-black text-slate-950">Destination folder</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {migrationSummary?.sourceFolderName
                          ? `${migrationSummary.sourceFolderName} is available in your Google Drive.`
                          : "Your migrated folder is available in Google Drive."}
                      </p>
                    </div>
                    <a
                      href={destinationDriveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-fit items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_-16px_rgba(37,99,235,0.8)] transition hover:-translate-y-0.5 hover:bg-blue-700"
                    >
                      Open in Google Drive
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  </Card>
                ) : null}

                {reportAvailable ? (
                  <Card className="flex flex-col justify-between gap-5">
                    <div>
                      <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                        <FileSpreadsheet className="h-5 w-5" />
                      </div>
                      <h2 className="text-lg font-black text-slate-950">Migration report</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">Download the file-by-file result for records or troubleshooting.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/migrations/${id}/report?format=csv`}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> CSV
                      </a>
                      <a
                        href={`/api/migrations/${id}/report?format=json`}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-blue-700"
                      >
                        <FileJson className="h-4 w-4" /> JSON
                      </a>
                    </div>
                  </Card>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : (
          <Card className="mx-auto max-w-xl text-center">
            <h2 className="text-xl font-black text-slate-950">Sign in to view this migration</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Migration records are private to the Google account that created them.</p>
          </Card>
        )}
      </main>
    </>
  );
}
