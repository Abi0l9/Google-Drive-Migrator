import Link from "next/link";
import { ArrowUpRight, Cloud, Folder } from "lucide-react";
import { cn } from "@/components/ui";

interface BrandProps {
  compact?: boolean;
  className?: string;
}

export function Brand({ compact = false, className }: BrandProps) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-3", className)} aria-label="GDM home">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-cyan-500 to-emerald-400 shadow-[0_12px_28px_-14px_rgba(37,99,235,0.8)] transition duration-200 group-hover:-translate-y-0.5">
        <Cloud className="absolute left-2 top-1.5 h-7 w-7 text-white/90" strokeWidth={1.8} />
        <Folder className="absolute bottom-1.5 left-2.5 h-5 w-5 fill-slate-950/90 text-slate-950" strokeWidth={1.8} />
        <ArrowUpRight className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-white p-0.5 text-blue-700" strokeWidth={2.6} />
      </span>
      {!compact ? (
        <span className="leading-none">
          <strong className="block text-[15px] font-extrabold tracking-[-0.02em] text-slate-950">GDM</strong>
          <span className="mt-1 block text-[11px] font-medium tracking-wide text-slate-500">Google Drive Migrator</span>
        </span>
      ) : null}
    </Link>
  );
}
