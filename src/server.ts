import express from "express";
import type { IFoundryRepository } from "./repository/index.js";
import { buildHealthRouter } from "./api/health.js";
import { buildProjectsRouter } from "./api/projects.js";
import { buildDecisionsRouter } from "./api/decisions.js";
import { buildEscalationsRouter } from "./api/escalations.js";
import { buildActivityRouter } from "./api/activity.js";
import { buildCapabilitiesRouter } from "./api/capabilities.js";
import { buildArtifactsRouter } from "./api/artifacts.js";

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
  app.use("/api/projects", buildProjectsRouter(repo));
  app.use("/api/decisions", buildDecisionsRouter(repo));
  app.use("/api/escalations", buildEscalationsRouter(repo));
  app.use("/api/activity", buildActivityRouter(repo));
  app.use("/api/capabilities", buildCapabilitiesRouter(repo));
  app.use("/api/artifacts", buildArtifactsRouter(repo));

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });
}
