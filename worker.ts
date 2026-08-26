import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { registerMigrationWorkers } = await import("@/lib/workers/migration-workers");
  registerMigrationWorkers();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
