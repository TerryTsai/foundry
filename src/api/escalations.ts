import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";

export function buildEscalationsRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // GET /api/escalations?projectId=
  router.get("/", (req, res) => {
    try {
      const { projectId } = req.query as Record<string, string | undefined>;
      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }
      const escalations = repo.escalations.getOpen(projectId);
      res.json(escalations);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/escalations/:id
  router.get("/:id", (req, res) => {
    try {
      const escalation = repo.escalations.get(req.params["id"]!);
      if (!escalation) {
        res.status(404).json({ error: "Escalation not found" });
        return;
      }
      res.json(escalation);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/escalations/:id/resolve
  // Body: { resolvedBy: "ceo" | "timeout", resolution?: string }
  router.post("/:id/resolve", (req, res) => {
    try {
      const id = req.params["id"]!;
      const { resolvedBy, resolution } = req.body as {
        resolvedBy?: string;
        resolution?: string;
      };

      if (resolvedBy !== "ceo" && resolvedBy !== "timeout") {
        res.status(400).json({ error: 'resolvedBy must be "ceo" or "timeout"' });
        return;
      }

      const escalation = repo.escalations.get(id);
      if (!escalation) {
        res.status(404).json({ error: "Escalation not found" });
        return;
      }
      if (escalation.resolvedAt) {
        res.status(409).json({ error: "Escalation already resolved" });
        return;
      }

      repo.escalations.resolve(id, {
        resolvedBy,
        ...(resolution !== undefined && { resolution }),
      });

      // If the founder provided an override, log it as a decision
      if (resolvedBy === "ceo" && resolution) {
        repo.decisions.append({
          projectId: escalation.projectId,
          domain: escalation.domain,
          topic: escalation.topic,
          decision: resolution,
          rationale: `Founder override of escalation ${id}. Agent recommendation was: ${escalation.draftDecision}`,
          madeBy: "ceo-override",
          impact: escalation.impact,
          reversibility: "easy",
        });

        repo.activity.append(escalation.projectId, "override-logged", {
          escalationId: id,
          topic: escalation.topic,
        });
      } else if (resolvedBy === "ceo") {
        // Accepted the agent's draft
        repo.decisions.append({
          projectId: escalation.projectId,
          domain: escalation.domain,
          topic: escalation.topic,
          decision: escalation.draftDecision,
          rationale: escalation.draftRationale,
          ...(escalation.draftAlternatives && { alternatives: escalation.draftAlternatives }),
          madeBy: "ceo",
          impact: escalation.impact,
          reversibility: "easy",
        });
      }

      repo.activity.append(escalation.projectId, "escalation-resolved", {
        escalationId: id,
        resolvedBy,
        topic: escalation.topic,
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
