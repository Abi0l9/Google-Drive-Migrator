import { FolderOpen, Gauge, RefreshCcw, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { AnalyzerForm } from "@/components/analyzer-form";
import { SignInButton, SignOutButton } from "@/components/auth-actions";
import { Card } from "@/components/ui";
import { isGoogleOAuthConfigured } from "@/lib/env";

const features = [
  { icon: FolderOpen, title: "Folder-first", copy: "Analyze a public Drive folder and preserve its nested structure during migration." },
  { icon: Gauge, title: "Live progress", copy: "Track completed files, failures, current transfer, copied bytes, and ETA." },
  { icon: RefreshCcw, title: "Safe recovery", copy: "Pause, resume, and retry failed transfers without duplicating completed files." },
  { icon: ShieldCheck, title: "Focused access", copy: "GDM uses Google's narrow drive.file permission for the destination you choose." },
];

export default async function Home() {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-lg font-bold tracking-tight text-slate-950">GDM</p>
          <p className="text-xs text-slate-500">Google Drive Migrator</p>
        </div>
        <div className="flex items-center gap-3">
          {session?.user?.email ? <p className="hidden text-sm text-slate-600 sm:block">{session.user.email}</p> : null}
          {session?.user?.email ? <SignOutButton /> : <SignInButton disabled={!googleOAuthConfigured} />}
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <p className="font-semibold uppercase tracking-[0.3em] text-blue-600">Move a folder. Keep the structure.</p>
          <h1 className="text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
            Move a public Drive folder into your Google Drive.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-600">
            Paste the source folder, review what is inside, choose where it should land, and let GDM recreate the tree and move the files without touching the source.
          </p>
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Public source</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Google Picker destination</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Pause + resume</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Migration report</span>
          </div>
        </div>
        <AnalyzerForm isAuthenticated={Boolean(session?.user?.email)} authConfigured={googleOAuthConfigured} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {features.map((feature) => (
          <Card key={feature.title}>
            <feature.icon className="mb-4 h-8 w-8 text-blue-600" />
            <h2 className="mb-2 font-semibold text-slate-950">{feature.title}</h2>
            <p className="text-sm leading-6 text-slate-600">{feature.copy}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
