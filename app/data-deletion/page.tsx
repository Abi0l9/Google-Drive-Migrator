import type { Metadata } from "next";
import { LegalSection, LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "How to revoke Google access and request deletion of GDM-held account and migration metadata.",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      eyebrow="Privacy"
      title="Data Deletion"
      intro="You can stop GDM from accessing your Google account and request deletion of GDM-held account and migration metadata."
    >
      <LegalSection title="Revoke Google access">
        <p>Open your Google Account security settings, review third-party connections, find GDM, and remove its access. This prevents GDM from using the previously granted Google authorization until you sign in and authorize it again.</p>
      </LegalSection>

      <LegalSection title="Delete GDM-held records">
        <p>To request deletion of your GDM account record and associated migration metadata, contact the developer/support contact published on the GDM Google OAuth consent screen and state that you are requesting GDM data deletion.</p>
        <p>For account verification, make the request from the same Google email address used with GDM. Do not send passwords, OAuth tokens, API keys, or other secrets.</p>
      </LegalSection>

      <LegalSection title="What deletion covers">
        <p>A completed deletion request is intended to remove GDM-held user and migration metadata that is not required to be retained for legal, security, abuse-prevention, or operational-integrity purposes.</p>
        <p>Deleting GDM records does not delete files already copied into your Google Drive or source files stored by Google. Those remain under your control in Google Drive.</p>
      </LegalSection>
    </LegalShell>
  );
}
