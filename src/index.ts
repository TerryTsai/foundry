import { config as loadEnv } from "dotenv";
loadEnv();

import { openRepository, repositoryConfigFromEnv } from "./repository/index.js";
import { startServer } from "./server.js";
import { Scheduler } from "./engine/scheduler.js";
import { seedCapabilities } from "./engine/seed.js";

async function main(): Promise<void> {
  const repoConfig = repositoryConfigFromEnv();

  console.log("[foundry] Opening repository...");
  const repo = await openRepository(repoConfig);
  console.log("[foundry] Repository ready");

  await seedCapabilities(repo);

  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  startServer(repo, { port });

  const intervalMinutes = parseInt(
    process.env["ENGINE_INTERVAL_MINUTES"] ?? "10",
    10
  );
  const scheduler = new Scheduler(
    { intervalMs: intervalMinutes * 60 * 1000, maxParallel: 1 },
    repo
  );
  scheduler.start();

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(`[foundry] ${signal} received, shutting down...`);
      scheduler.stop();
      repo.close().then(() => process.exit(0)).catch(() => process.exit(1));
    });
  }
}

main().catch((err) => {
  console.error("[foundry] Fatal error:", err);
  process.exit(1);
});
