import { auth } from "@/auth";
import { Card } from "@/components/ui";

export default async function DashboardPage() {
  const session = await auth();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-2 text-3xl font-bold">Migration Dashboard</h1>
      <p className="mb-8 text-slate-600">Signed in as {session?.user?.email ?? "guest"}. Select a destination folder, start a migration, and monitor progress.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm text-slate-500">Completed Files</p><strong className="text-3xl">0</strong></Card>
        <Card><p className="text-sm text-slate-500">Failed Files</p><strong className="text-3xl">0</strong></Card>
        <Card><p className="text-sm text-slate-500">Transfer Speed</p><strong className="text-3xl">—</strong></Card>
      </div>
    </main>
  );
}
