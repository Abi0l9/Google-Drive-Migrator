import Link from "next/link";
import { LayoutDashboard, ShieldCheck, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { SignInButton, SignOutButton } from "@/components/auth-actions";

interface SiteHeaderProps {
  email?: string | null;
  authConfigured: boolean;
  isAdmin?: boolean;
}

export function SiteHeader({ email, authConfigured, isAdmin = false }: SiteHeaderProps) {
  const isAuthenticated = Boolean(email);

  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-[#f8fbff]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6 lg:px-8">
        <Brand />

        <nav className="hidden items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/80 p-1 shadow-sm md:flex" aria-label="Primary navigation">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700">
            <Sparkles className="h-4 w-4" />
            Migrate
          </Link>
          {isAuthenticated ? (
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-700">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Link>
          ) : null}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          {email ? (
            <div className="hidden min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm lg:flex">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <span className="max-w-44 truncate">{email}</span>
            </div>
          ) : null}
          {isAuthenticated ? <SignOutButton /> : <SignInButton disabled={!authConfigured} />}
        </div>
      </div>

      {isAuthenticated ? (
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-5 pb-3 md:hidden sm:px-6">
          <Link href="/" className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Migrate</Link>
          <Link href="/dashboard" className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Dashboard</Link>
          {isAdmin ? <Link href="/admin" className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Admin</Link> : null}
        </div>
      ) : null}
    </header>
  );
}
