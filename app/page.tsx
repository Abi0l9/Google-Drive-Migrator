import { FolderOpen, Gauge, RefreshCcw, ShieldCheck } from "lucide-react";
import { AnalyzerForm } from "@/components/analyzer-form";
import { Card } from "@/components/ui";

const features = [
  { icon: FolderOpen, title: "Recursive scans", copy: "Analyze every public subfolder and file before a migration starts." },
  { icon: Gauge, title: "Live progress", copy: "Track completed files, failures, current file, bytes copied, and ETA." },
  { icon: RefreshCcw, title: "Retry ready", copy: "Failed transfers are recorded and queued for safe retry without restarting." },
  { icon: ShieldCheck, title: "Secure OAuth", copy: "Users authenticate with Google; source folders remain untouched." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12">
      <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <p className="font-semibold uppercase tracking-[0.3em] text-blue-600">Google Drive Folder Migrator</p>
          <h1 className="text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
            Copy any public Drive folder into your Google Drive.
          </h1>
          <p className="text-lg leading-8 text-slate-600">
            Paste a public Google Drive folder URL, review its size and structure, authenticate with Google,
            choose a destination, and let the migration queue recreate the folder tree and stream files for you.
          </p>
        </div>
        <AnalyzerForm />
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
