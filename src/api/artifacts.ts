import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";
import type { ArtifactType } from "../repository/types.js";

export function buildArtifactsRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/artifacts?projectId=&type=
  router.get("/", (req, res) => {
    try {
      const { projectId, type } = req.query as Record<string, string | undefined>;
      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }
      const artifacts = repo.artifacts.list(projectId, type as ArtifactType | undefined);
      res.json(artifacts);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/artifacts/:id
  router.get("/:id", (req, res) => {
    try {
      const artifact = repo.artifacts.get(req.params["id"]!);
      // Return metadata only (not content) in the list view
      const { content: _content, ...meta } = artifact;
      res.json(meta);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/artifacts/:id/download  — streams the raw content
  router.get("/:id/download", (req, res) => {
    try {
      const artifact = repo.artifacts.get(req.params["id"]!);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${artifact.name}"`
      );
      res.send(artifact.content);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/artifacts/snapshot  — manual code snapshot
  router.post("/snapshot", async (req, res) => {
    try {
      const { projectId, repoPath } = req.body as {
        projectId?: string;
        repoPath?: string;
      };
      if (!projectId || !repoPath) {
        res.status(400).json({ error: "projectId and repoPath are required" });
        return;
      }
      const artifact = await repo.artifacts.snapshotCode(projectId, repoPath, "manual");
      res.status(201).json(artifact);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
