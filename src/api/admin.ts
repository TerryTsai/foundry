import { Router } from "express";
import { join } from "node:path";
import type { IFoundryRepository } from "../repository/index.js";
import type { Scheduler } from "../engine/scheduler.js";

export function buildAdminRouter(
  repo: IFoundryRepository,
  scheduler: Scheduler
): Router {
  const router = Router();

  // POST /api/admin/backup
  router.post("/backup", async (req, res) => {
    try {
      const { path: backupPath, compress = true } = req.body as {
        path?: string;
        compress?: boolean;
      };

      const dest =
        backupPath ??
        join(
          process.env["FOUNDRY_DATA_DIR"] ?? process.cwd(),
          `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar`
        );

      const result = await repo.backup({
        path: dest,
        compress,
        includeBlobs: true,
        verify: true,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/admin/run/:projectId — trigger engine run immediately
  router.post("/run/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params as { projectId: string };
      const project = repo.projects.get(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const current = repo.engineRuns.getCurrent(projectId);
      if (current?.status === "running") {
        res.status(409).json({ error: "Engine run already in progress" });
        return;
      }

      // Fire and forget — return immediately, run happens in background
      scheduler.runNow(projectId).catch((err: unknown) => {
        console.error(`[admin] manual run failed for ${projectId}:`, err);
      });

      res.json({ queued: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/admin/runs/:projectId — current + last run status
  router.get("/runs/:projectId", (req, res) => {
    try {
      const { projectId } = req.params as { projectId: string };
      const current = repo.engineRuns.getCurrent(projectId);
      const last = repo.engineRuns.getLastCompleted(projectId);
      res.json({ current, last });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
