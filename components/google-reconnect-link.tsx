interface GoogleReconnectLinkProps {
  redirectTo: string;
  className?: string;
}

export function GoogleReconnectLink({ redirectTo, className = "" }: GoogleReconnectLinkProps) {
  const href = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(redirectTo)}`;

  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 ${className}`.trim()}
    >
      Reconnect Google Drive
    </a>
  );
}
