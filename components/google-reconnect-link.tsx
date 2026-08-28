import { RefreshCcw } from "lucide-react";

interface GoogleReconnectLinkProps {
  redirectTo: string;
  className?: string;
}

export function GoogleReconnectLink({ redirectTo, className = "" }: GoogleReconnectLinkProps) {
  const href = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(redirectTo)}`;

  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 ${className}`.trim()}
    >
      <RefreshCcw className="h-4 w-4" />
      Reconnect Google Drive
    </a>
  );
}
