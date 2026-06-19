import { Card } from "@/components/ui";

const metrics = ["Total Users", "Total Migrations", "Active Migrations", "Failed Migrations", "Total Files Migrated", "Total Data Transferred"];

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-8 text-3xl font-bold">Admin Dashboard</h1>
      <section className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => <Card key={metric}><p className="text-sm text-slate-500">{metric}</p><strong className="text-3xl">0</strong></Card>)}
      </section>
    </main>
  );
}
