import { Router } from "express";
import type { Request } from "express";
import type { IFoundryRepository } from "../repository/index.js";
import type { ProjectConfig } from "../repository/types.js";

type ProjectParams = { id: string };

export function buildConfigRouter(repo: IFoundryRepository): Router {
  const router = Router({ mergeParams: true });

  // GET /api/projects/:id/config
  router.get("/", (req: Request<ProjectParams>, res) => {
    try {
      const projectId = req.params.id;
      const config = repo.projectConfig.get(projectId);
      if (!config) {
        res.status(404).json({ error: "Project config not found" });
        return;
      }
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // PUT /api/projects/:id/config
  router.put("/", (req: Request<ProjectParams>, res) => {
    try {
      const projectId = req.params.id;
      const body = req.body as ProjectConfig;

      if (!body?.workspace || !Array.isArray(body.agents) || !Array.isArray(body.tail)) {
        res.status(400).json({ error: "config with workspace, agents, and tail is required" });
        return;
      }

      const validation = repo.projectConfig.validateDag(body);
      if (!validation.valid) {
        res.status(400).json({ errors: validation });
        return;
      }

      const updated = repo.projectConfig.set(projectId, body, "founder");
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/projects/:id/config/history
  router.get("/history", (req: Request<ProjectParams>, res) => {
    try {
      const projectId = req.params.id;
      const versions = repo.projectConfig.listVersions(projectId);
      res.json(versions);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
