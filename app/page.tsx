import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FolderInput,
  FolderOutput,
  Gauge,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { auth } from "@/auth";
import { AnalyzerForm } from "@/components/analyzer-form";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { isAdminEmail, isGoogleOAuthConfigured } from "@/lib/env";

const features = [
  {
    icon: Waypoints,
    title: "Structure stays intact",
    copy: "Nested folders are recreated in the same hierarchy, so the destination still feels familiar.",
  },
  {
    icon: Gauge,
    title: "Progress you can trust",
    copy: "See file counts, copied data, the current transfer, speed, ETA, and failures as they happen.",
  },
  {
    icon: RefreshCcw,
    title: "Built to recover",
    copy: "Pause, resume, and retry failed files without starting the entire migration from scratch.",
  },
  {
    icon: ShieldCheck,
    title: "Focused Drive access",
    copy: "GDM uses Google’s narrow drive.file permission for the destination you explicitly choose.",
  },
];

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email;
  const googleOAuthConfigured = isGoogleOAuthConfigured();

  return (
    <>
      <SiteHeader
        email={email}
        authConfigured={googleOAuthConfigured}
        isAdmin={isAdminEmail(email)}
      />

      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 sm:px-6 sm:pt-14 lg:px-8 lg:pb-24">
        <section className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)] lg:gap-14">
          <div className="pt-3 lg:pt-10">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-blue-50/80 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-blue-700 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Drive migration, minus the chaos
            </div>

            <h1 className="max-w-3xl text-4xl font-black tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-[4.15rem] lg:leading-[1.02]">
              Move a Drive folder.
              <span className="block bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500 bg-clip-text text-transparent">
                Keep everything where it belongs.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              GDM copies a public Google Drive folder into your own Drive, recreates its folder tree, and keeps the source untouched. Paste, review, choose a destination, migrate.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#migrate"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-[0_16px_32px_-18px_rgba(15,23,42,0.7)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Start a migration
                <ArrowRight className="h-4 w-4" />
              </a>
              {email ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700"
                >
                  View dashboard
                </Link>
              ) : null}
            </div>

            <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                "Source stays untouched",
                "No local download step",
                "Retry-safe transfers",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {item}
                </div>
              ))}
            </div>

            <Card className="mt-10 overflow-hidden p-0">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">The whole journey</p>
              </div>
              <div className="grid gap-0 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
                <div className="p-5">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                    <FolderInput className="h-5 w-5" />
                  </div>
                  <strong className="block text-sm text-slate-950">Public source</strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Paste a shareable Drive folder link.</span>
                </div>
                <ArrowRight className="mx-auto hidden h-4 w-4 text-slate-300 sm:block" />
                <div className="border-y border-slate-100 p-5 sm:border-x sm:border-y-0">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-cyan-50 text-cyan-600">
                    <Waypoints className="h-5 w-5" />
                  </div>
                  <strong className="block text-sm text-slate-950">GDM moves it</strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Folders and files stream into the queue.</span>
                </div>
                <ArrowRight className="mx-auto hidden h-4 w-4 text-slate-300 sm:block" />
                <div className="p-5">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <FolderOutput className="h-5 w-5" />
                  </div>
                  <strong className="block text-sm text-slate-950">Your Drive</strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Open the recreated folder when it lands.</span>
                </div>
              </div>
            </Card>
          </div>

          <div id="migrate" className="scroll-mt-28">
            <AnalyzerForm
              isAuthenticated={Boolean(email)}
              authConfigured={googleOAuthConfigured}
            />
          </div>
        </section>

        <section className="mt-16 lg:mt-24">
          <div className="mb-7 max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Quietly capable</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Sharp enough for the job, without becoming a control-room maze.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {features.map((feature) => (
              <Card key={feature.title} className="group transition duration-200 hover:-translate-y-1 hover:border-blue-200/80 hover:shadow-[0_24px_70px_-40px_rgba(37,99,235,0.45)]">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-600 transition group-hover:scale-105">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="font-bold text-slate-950">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{feature.copy}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
