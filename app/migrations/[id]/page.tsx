import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-actions";
import { ProgressPanel } from "@/components/progress-panel";
import { isGoogleOAuthConfigured } from "@/lib/env";

interface MigrationPageProps {
  params: Promise<{ id: string }>;
}

export default async function MigrationPage({ params }: MigrationPageProps) {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  const { id } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold uppercase tracking-[0.2em] text-blue-600">Migration</p>
          <h1 className="text-3xl font-bold text-slate-950">Progress</h1>
        </div>
        {!session?.user?.email ? <SignInButton disabled={!googleOAuthConfigured} /> : null}
      </div>

      {session?.user?.email ? <ProgressPanel migrationId={id} /> : <p className="text-slate-600">Sign in to view this migration.</p>}
    </main>
  );
}
