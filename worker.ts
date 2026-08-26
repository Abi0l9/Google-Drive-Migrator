import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { registerMigrationWorkers } = await import("@/lib/workers/migration-workers");
  const { closeMigrationQueueResources } = await import("@/lib/queue/migrations");
  const workers = registerMigrationWorkers();
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; closing migration workers...`);

    const results = await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeMigrationQueueResources();

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      console.error(`Failed to close ${failed.length} migration worker(s) cleanly.`);
      process.exitCode = 1;
    }
  }

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
