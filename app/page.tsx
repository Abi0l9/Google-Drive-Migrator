import Link from "next/link";
import { FolderOpen, Gauge, RefreshCcw, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { AnalyzerForm } from "@/components/analyzer-form";
import { SignInButton, SignOutButton } from "@/components/auth-actions";
import { GdmBrand, GdmFooter } from "@/components/brand";
import { Card } from "@/components/ui";
import { isGoogleOAuthConfigured } from "@/lib/env";

const features = [
  { icon: FolderOpen, title: "Recursive scans", copy: "Analyze every public subfolder and file before a migration starts." },
  { icon: Gauge, title: "Live progress", copy: "Track completed files, failures, current file, bytes copied, and ETA." },
  { icon: RefreshCcw, title: "Retry ready", copy: "Failed transfers are recorded and queued for safe retry without restarting." },
  { icon: ShieldCheck, title: "User-controlled access", copy: "Google Picker and scoped OAuth keep destination access limited to the files you choose or create with GDM." },
];

export default async function Home() {
  const session = await auth();
  const googleOAuthConfigured = isGoogleOAuthConfigured();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <GdmBrand priority />
        <div className="flex items-center gap-3">
          {session?.user?.email ? (
            <Link href="/dashboard" className="hidden text-sm font-medium text-slate-700 hover:text-slate-950 sm:block">
              Dashboard
            </Link>
          ) : null}
          {session?.user?.email ? <p className="hidden text-sm text-slate-500 lg:block">{session.user.email}</p> : null}
          {session?.user?.email ? <SignOutButton /> : <SignInButton disabled={!googleOAuthConfigured} />}
        </div>
      </header>

      <section className="grid flex-1 gap-8 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-20">
        <div className="space-y-6">
          <p className="font-semibold uppercase tracking-[0.3em] text-blue-600">Cloud-to-cloud Drive migration</p>
          <h1 className="text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
            Move a public Drive folder into your Google Drive without downloading it first.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-600">
            Paste a public Google Drive folder URL, review its size and structure, authenticate with Google,
            choose a destination, and let GDM recreate the folder tree and stream files directly in the cloud.
          </p>
          <p className="max-w-2xl text-sm leading-6 text-slate-500">
            GDM does not modify the source folder. Destination access is requested through Google OAuth and Picker so you stay in control of what the app can use.
          </p>
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

      <GdmFooter />
    </main>
  );
}
