import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteUrl = "https://gdm.innovvohq.online";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "GDM | Google Drive Folder Migrator",
  description: "Copy public Google Drive folders into your own Drive account.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "GDM | Google Drive Folder Migrator",
    description: "Copy public Google Drive folders into your own Drive account.",
    url: "/",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
