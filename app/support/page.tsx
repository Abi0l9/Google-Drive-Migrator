import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Support",
  description: "Help and support information for GDM Google Drive Migrator.",
};

export default function SupportPage() {
  return (
    <LegalShell
      eyebrow="Help"
      title="GDM Support"
      intro="Use these steps when a migration does not behave as expected. GDM is designed to keep source files untouched and make failures visible rather than silently dropping work."
    >
      <LegalSection title="Before contacting support">
        <ul className="list-disc space-y-2 pl-5">
          <li>Open the migration progress page and check the failed-file count.</li>
          <li>Use Retry if the failure is temporary or caused by a Google API interruption.</li>
          <li>Download the CSV or JSON migration report when available.</li>
          <li>Confirm that the destination Google Drive account still has enough storage.</li>
          <li>If Google access was revoked, sign in again before resuming.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Privacy or deletion requests">
        <p>For account-data deletion instructions, use the dedicated <Link href="/data-deletion" className="font-medium text-blue-700 hover:underline">Data Deletion page</Link>.</p>
      </LegalSection>

      <LegalSection title="Contacting the GDM team">
        <p>Use the developer/support contact displayed on the GDM Google OAuth consent screen. Include the migration ID and report when relevant, but never send OAuth tokens, passwords, API keys, or other account secrets.</p>
      </LegalSection>
    </LegalShell>
  );
}
