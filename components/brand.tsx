import Image from "next/image";
import Link from "next/link";

interface BrandProps {
  href?: string;
  compact?: boolean;
  priority?: boolean;
}

export function GdmBrand({ href = "/", compact = false, priority = false }: BrandProps) {
  return (
    <Link href={href} className="inline-flex items-center" aria-label="GDM home">
      {compact ? (
        <span className="inline-flex items-center gap-2.5">
          <Image src="/brand/gdm-icon.svg" alt="" width={40} height={40} priority={priority} />
          <span className="text-lg font-bold tracking-tight text-slate-950">GDM</span>
        </span>
      ) : (
        <Image
          src="/brand/gdm-logo.svg"
          alt="GDM - Google Drive Migrator"
          width={240}
          height={80}
          priority={priority}
          className="h-auto w-[190px] sm:w-[220px]"
        />
      )}
    </Link>
  );
}

export function GdmFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 py-8 text-sm text-slate-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src="/brand/gdm-icon.svg" alt="" width={28} height={28} />
          <span>GDM by Innovvo Tech</span>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legal and support">
          <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-950">Terms</Link>
          <Link href="/support" className="hover:text-slate-950">Support</Link>
          <Link href="/data-deletion" className="hover:text-slate-950">Data deletion</Link>
        </nav>
      </div>
    </footer>
  );
}
