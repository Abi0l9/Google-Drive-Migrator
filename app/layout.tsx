import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "GDM",
  title: {
    default: "GDM | Google Drive Migrator",
    template: "%s | GDM",
  },
  description: "Migrate public Google Drive folders into your own Drive with cloud-to-cloud transfer, progress tracking, retries, and resumable copying.",
  icons: {
    icon: [{ url: "/brand/gdm-icon.svg", type: "image/svg+xml" }],
    shortcut: "/brand/gdm-icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "GDM",
    title: "GDM | Google Drive Migrator",
    description: "Cloud-to-cloud Google Drive folder migration with progress tracking, retries, and resumable copying.",
  },
  twitter: {
    card: "summary",
    title: "GDM | Google Drive Migrator",
    description: "Cloud-to-cloud Google Drive folder migration.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
