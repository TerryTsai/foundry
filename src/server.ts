import express from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IFoundryRepository } from "./repository/index.js";
import type { Scheduler } from "./loop/scheduler.js";
import { buildHealthRouter } from "./api/health.js";
import { buildProjectsRouter } from "./api/projects.js";
import { buildDecisionsRouter } from "./api/decisions.js";
import { buildEscalationsRouter } from "./api/escalations.js";
import { buildActivityRouter } from "./api/activity.js";
import { buildCapabilitiesRouter } from "./api/capabilities.js";
import { buildArtifactsRouter } from "./api/artifacts.js";
import { buildOnboardingRouter } from "./api/onboarding.js";
import { buildAdminRouter } from "./api/admin.js";
import { buildTasksRouter } from "./api/tasks.js";
import { buildConfigRouter } from "./api/config.js";

export interface ServerConfig {
  port: number;
}

export function startServer(
  repo: IFoundryRepository,
  scheduler: Scheduler,
  config: ServerConfig
): void {
  const app = express();
  app.use(express.json());

  app.use("/api/health", buildHealthRouter(repo));
  app.use("/api/projects", buildProjectsRouter(repo));
  app.use("/api/projects/:id/config", buildConfigRouter(repo));
  app.use("/api/decisions", buildDecisionsRouter(repo));
  app.use("/api/escalations", buildEscalationsRouter(repo));
  app.use("/api/activity", buildActivityRouter(repo));
  app.use("/api/capabilities", buildCapabilitiesRouter(repo));
  app.use("/api/artifacts", buildArtifactsRouter(repo));
  app.use("/api/onboarding", buildOnboardingRouter(repo));
  app.use("/api/admin", buildAdminRouter(repo, scheduler));
  app.use("/api/tasks", buildTasksRouter(repo));

  // Serve static React build from ui/dist
  const here = dirname(fileURLToPath(import.meta.url));
  const uiDist = join(here, "..", "ui", "dist");
  if (existsSync(uiDist)) {
    app.use(express.static(uiDist));
    // SPA fallback — any non-API route serves index.html
    app.get("*", (_req, res) => {
      res.sendFile(join(uiDist, "index.html"));
    });
  }

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });
}
