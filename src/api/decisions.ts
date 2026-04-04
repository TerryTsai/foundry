import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";
import type { DecisionDomain, DecisionImpact, DecisionMadeBy } from "../repository/types.js";

export function buildDecisionsRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/decisions?projectId=&domain=&impact=&madeBy=&view=latest
  // view=latest returns one decision per topic (state of world)
  // view=log (default) returns full append-only history
  router.get("/", (req, res) => {
    try {
      const { projectId, domain, impact, madeBy, view } = req.query as Record<string, string | undefined>;

      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }

      if (view === "latest") {
        const decisions = repo.decisions.latestPerTopic(
          projectId,
          domain as DecisionDomain | undefined
        );
        res.json(decisions);
        return;
      }

      const decisions = repo.decisions.query({
        projectId,
        ...(domain && { domain: domain as DecisionDomain }),
        ...(impact && { impact: impact as DecisionImpact }),
        ...(madeBy && { madeBy: madeBy as DecisionMadeBy }),
      });
      res.json(decisions);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/decisions/topic?projectId=&topic=
  router.get("/topic", (req, res) => {
    try {
      const { projectId, topic } = req.query as Record<string, string | undefined>;
      if (!projectId || !topic) {
        res.status(400).json({ error: "projectId and topic are required" });
        return;
      }
      const history = repo.decisions.getHistory(projectId, topic);
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
