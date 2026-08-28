import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gdm.innovvohq.online"),
  applicationName: "GDM",
  title: {
    default: "GDM — Google Drive Migrator",
    template: "%s | GDM",
  },
  description: "Move public Google Drive folders into your own Drive while preserving folder structure and tracking progress.",
  openGraph: {
    title: "GDM — Google Drive Migrator",
    description: "Move a public Drive folder. Keep its structure. Track the transfer.",
    type: "website",
    siteName: "GDM",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
