import type { ReactNode } from "react";
import { GdmBrand, GdmFooter } from "@/components/brand";

interface LegalShellProps {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}

export function LegalShell({ eyebrow, title, intro, children }: LegalShellProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-8 sm:py-10">
      <header className="mb-12">
        <GdmBrand priority />
      </header>
      <article className="flex-1">
        <p className="font-semibold uppercase tracking-[0.24em] text-blue-600">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">{intro}</p>
        <div className="prose-gdm mt-10 space-y-8 text-sm leading-7 text-slate-700">{children}</div>
      </article>
      <GdmFooter />
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold text-slate-950">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
