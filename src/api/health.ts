import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import type { IFoundryRepository } from "../repository/index.js";

export function buildHealthRouter(repo: IFoundryRepository): Router {
  const router = createRouter();

  router.get("/", (_req: Request, res: Response) => {
    repo
      .healthCheck()
      .then((health) => {
        const statusCode = health.status === "ok" ? 200 : 503;
        res.status(statusCode).json(health);
      })
      .catch((err: unknown) => {
        res.status(500).json({ status: "error", error: String(err) });
      });
  });

  return router;
}
