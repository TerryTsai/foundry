import { Router } from "express";
import type { IFoundryRepository } from "../repository/index.js";
import type { NewCapabilityDefinition, CapabilityCategory, CapabilityActionType } from "../repository/types.js";

export function buildCapabilitiesRouter(repo: IFoundryRepository): Router {
  const router = Router();

  // ── Library (definitions) ─────────────────────────────────────

  // GET /api/capabilities/definitions?category=
  router.get("/definitions", (req, res) => {
    try {
      const { category } = req.query as Record<string, string | undefined>;
      const defs = repo.capabilities.listDefinitions(category);
      res.json(defs);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/capabilities/definitions/:id
  router.get("/definitions/:id", (req, res) => {
    try {
      const def = repo.capabilities.getDefinition(req.params["id"]!);
      if (!def) {
        res.status(404).json({ error: "Capability definition not found" });
        return;
      }
      const actions = repo.capabilities.listActions(req.params["id"]!);
      res.json({ ...def, actions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/definitions  (custom capabilities)
  router.post("/definitions", (req, res) => {
    try {
      const body = req.body as Partial<NewCapabilityDefinition>;
      if (!body.name || !body.category || !body.description) {
        res.status(400).json({ error: "name, category, and description are required" });
        return;
      }
      const def = repo.capabilities.createDefinition({
        name: body.name,
        category: body.category as CapabilityCategory,
        description: body.description,
        setupGuide: body.setupGuide ?? "",
        configSchema: body.configSchema ?? { type: "object", properties: {} },
        isBuiltin: false,
      });
      res.status(201).json(def);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/definitions/:id/actions
  router.post("/definitions/:id/actions", (req, res) => {
    try {
      const capabilityId = req.params["id"]!;
      const def = repo.capabilities.getDefinition(capabilityId);
      if (!def) {
        res.status(404).json({ error: "Capability definition not found" });
        return;
      }
      const { name, description, actionType, script, paramSchema, isDestructive, requiresApproval } =
        req.body as {
          name?: string;
          description?: string;
          actionType?: string;
          script?: string;
          paramSchema?: Record<string, unknown>;
          isDestructive?: boolean;
          requiresApproval?: boolean;
        };
      if (!name || !description || !actionType || !script) {
        res.status(400).json({ error: "name, description, actionType, and script are required" });
        return;
      }
      const validTypes = ["bash", "http", "playwright"];
      if (!validTypes.includes(actionType)) {
        res.status(400).json({ error: `actionType must be one of: ${validTypes.join(", ")}` });
        return;
      }
      const action = repo.capabilities.createAction(capabilityId, {
        name,
        description,
        actionType: actionType as CapabilityActionType,
        script,
        paramSchema: paramSchema ?? null,
        isDestructive: isDestructive ?? false,
        requiresApproval: requiresApproval ?? false,
      });
      res.status(201).json(action);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Project capabilities ──────────────────────────────────────

  // GET /api/capabilities/project?projectId=
  router.get("/project", (req, res) => {
    try {
      const { projectId } = req.query as Record<string, string | undefined>;
      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }
      const pcs = repo.capabilities.listForProject(projectId);
      const enriched = pcs.map((pc) => {
        const def = repo.capabilities.getDefinition(pc.capabilityId);
        return { ...pc, definition: def };
      });
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/project  — add a capability to a project
  router.post("/project", (req, res) => {
    try {
      const { projectId, capabilityId } = req.body as {
        projectId?: string;
        capabilityId?: string;
      };
      if (!projectId || !capabilityId) {
        res.status(400).json({ error: "projectId and capabilityId are required" });
        return;
      }
      const pc = repo.capabilities.addToProject(projectId, capabilityId);
      res.status(201).json(pc);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/capabilities/project/:id
  router.get("/project/:id", (req, res) => {
    try {
      const pc = repo.capabilities.getProjectCapability(req.params["id"]!);
      if (!pc) {
        res.status(404).json({ error: "Project capability not found" });
        return;
      }
      const def = repo.capabilities.getDefinition(pc.capabilityId);
      const actions = repo.capabilities.listActions(pc.capabilityId);
      const executions = repo.capabilities.getExecutionHistory(pc.id, 20);
      res.json({ ...pc, definition: def, actions, executions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/project/:id/credentials
  router.post("/project/:id/credentials", (req, res) => {
    try {
      const id = req.params["id"]!;
      const pc = repo.capabilities.getProjectCapability(id);
      if (!pc) {
        res.status(404).json({ error: "Project capability not found" });
        return;
      }
      const credentials = req.body as Record<string, string>;
      if (!credentials || typeof credentials !== "object") {
        res.status(400).json({ error: "Body must be a credentials object" });
        return;
      }
      repo.capabilities.saveCredentials(id, credentials);
      repo.capabilities.setStatus(id, "configured");
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/project/:id/test
  router.post("/project/:id/test", async (req, res) => {
    try {
      const id = req.params["id"]!;
      const pc = repo.capabilities.getProjectCapability(id);
      if (!pc) {
        res.status(404).json({ error: "Project capability not found" });
        return;
      }
      const def = repo.capabilities.getDefinition(pc.capabilityId);
      const actions = repo.capabilities.listActions(pc.capabilityId);
      const testAction = actions.find((a) => a.name === "capture-state") ?? actions[0];
      if (!testAction) {
        res.status(400).json({ error: "No actions available to test" });
        return;
      }
      const result = await repo.capabilities.execute(id, testAction.name, {}, "founder-test");
      const success = result.status === "success";
      repo.capabilities.setStatus(id, success ? "active" : "error", result.error ?? undefined);
      res.json({ success, output: result.output, error: result.error });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/capabilities/project/:id/execute
  router.post("/project/:id/execute", async (req, res) => {
    try {
      const id = req.params["id"]!;
      const { actionName, params } = req.body as {
        actionName?: string;
        params?: Record<string, string>;
      };
      if (!actionName) {
        res.status(400).json({ error: "actionName is required" });
        return;
      }
      const result = await repo.capabilities.execute(id, actionName, params ?? {}, "founder-test");
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
