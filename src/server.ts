import express from "express";
import type { IFoundryRepository } from "./repository/index.js";
import { buildHealthRouter } from "./api/health.js";

export interface ServerConfig {
  port: number;
}

export function startServer(
  repo: IFoundryRepository,
  config: ServerConfig
): void {
  const app = express();
  app.use(express.json());

  app.use("/api/health", buildHealthRouter(repo));

  // Phase 1: health only. Other routes added in Phase 3.

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });
}
