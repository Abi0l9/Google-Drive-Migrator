import type { Metadata } from "next";
import { LegalSection, LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of GDM Google Drive Migrator.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms govern your use of GDM, operated by Innovvo Tech. Last updated: August 27, 2026."
    >
      <LegalSection title="Using GDM">
        <p>You may use GDM to migrate Google Drive content that you are authorized to access and copy. You are responsible for ensuring you have the rights and permissions required for the source content and destination account.</p>
      </LegalSection>

      <LegalSection title="Your Google account">
        <p>GDM relies on Google OAuth and Google Drive APIs. You remain responsible for your Google account, Google Drive storage limits, and compliance with Google&apos;s applicable terms and policies.</p>
      </LegalSection>

      <LegalSection title="Migration behavior">
        <p>GDM is designed to preserve source content and create copies in the destination you select. Some Google Workspace files may be exported into compatible formats such as DOCX, XLSX, or PPTX. File metadata or behavior can differ from the original Google-native file after export.</p>
      </LegalSection>

      <LegalSection title="Service limits">
        <p>GDM may pause or delay work when infrastructure, Google API, abuse-prevention, or free-tier limits are reached. Limits may change as the service evolves. GDM will not intentionally bypass provider limits or silently incur paid infrastructure charges on a user&apos;s behalf.</p>
      </LegalSection>

      <LegalSection title="Availability and warranties">
        <p>GDM is provided on an as-available basis. Although the service is built with resumable transfers, retries, reporting, and failure handling, no migration service can guarantee that every file will always transfer successfully. You should review the migration report and destination before deleting any original data.</p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>Do not use GDM to access data without permission, infringe intellectual property rights, evade provider restrictions, distribute malware, or interfere with the service or its infrastructure.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>These terms may be updated as GDM gains new providers, pricing, limits, or capabilities. Material changes will be reflected on this page.</p>
      </LegalSection>
    </LegalShell>
  );
}
