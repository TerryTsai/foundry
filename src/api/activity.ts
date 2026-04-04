import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";

export function buildActivityRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/activity?projectId=&limit=
  router.get("/", (req, res) => {
    try {
      const { projectId, limit } = req.query as Record<string, string | undefined>;
      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      if (parsedLimit !== undefined && (isNaN(parsedLimit) || parsedLimit < 1)) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      const entries = repo.activity.list(projectId, parsedLimit);
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
