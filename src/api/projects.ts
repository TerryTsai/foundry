import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";

export function buildProjectsRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/projects
  router.get("/", (req, res) => {
    try {
      const status = req.query["status"] as string | undefined;
      const validStatuses = ["active", "paused", "complete", "archived"];
      if (status !== undefined && !validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status: ${status}` });
        return;
      }
      const projects = repo.projects.list(
        status as "active" | "paused" | "complete" | "archived" | undefined
      );
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/projects/:id
  router.get("/:id", (req, res) => {
    try {
      const project = repo.projects.get(req.params["id"]!);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
