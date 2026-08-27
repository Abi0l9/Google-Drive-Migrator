import type { Metadata } from "next";
import { LegalSection, LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How GDM accesses, uses, stores, and protects Google user data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains how GDM, operated by Innovvo Tech, handles information when you use Google Drive Migrator. Last updated: August 27, 2026."
    >
      <LegalSection title="Information we receive">
        <p>When you sign in with Google, GDM receives the basic account information needed for authentication, such as your email address and Google account identifier.</p>
        <p>When you authorize Drive access, GDM receives OAuth credentials that allow it to perform the migration actions you request. GDM uses the Google Drive <code>drive.file</code> scope so access is limited to files and folders you choose with Google Picker or files GDM creates for you.</p>
      </LegalSection>

      <LegalSection title="How Google user data is used">
        <p>Google user data is used only to provide and operate the migration service, including selecting a destination, creating folders and files, resuming transfers, detecting migration-created items, showing progress, and producing migration reports.</p>
        <p>GDM does not use Google Drive contents for advertising, profiling, or training generalized AI models.</p>
      </LegalSection>

      <LegalSection title="What we store">
        <p>GDM stores migration metadata such as source and destination identifiers, file names, sizes, progress, status, timestamps, retry information, and operational counters. OAuth tokens and resumable upload session details are stored encrypted where persistence is required to complete or resume a migration.</p>
        <p>The file contents being migrated are streamed between Google Drive and the cloud migration runtime. GDM does not intentionally retain a separate permanent copy of migrated file contents.</p>
      </LegalSection>

      <LegalSection title="Sharing and sale of data">
        <p>GDM does not sell Google user data. Data is shared only with infrastructure and service providers required to operate GDM, or when required by law. Google Drive itself remains the source and destination service for migration content.</p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>Migration records may be retained for reliability, troubleshooting, reporting, and abuse prevention. You may revoke GDM&apos;s Google access at any time from your Google Account permissions. You may also request deletion of GDM-held account and migration metadata through the process described on the Data Deletion page.</p>
      </LegalSection>

      <LegalSection title="Security">
        <p>GDM uses scoped OAuth access, encrypted persisted credentials, authenticated user ownership checks, and cloud runtime controls designed to reduce unnecessary access to your Google Drive data. No internet service can guarantee absolute security, but GDM is designed to minimize the data and permissions it requires.</p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>If GDM materially changes how it accesses or uses Google user data, this policy will be updated before those changes are relied on for production use.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>For privacy questions or requests, use the developer/support contact published by GDM and on its Google OAuth consent screen.</p>
      </LegalSection>
    </LegalShell>
  );
}
