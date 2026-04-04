// In-process MCP server exposing the five agent tools.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IFoundryRepository } from "../repository/index.js";
import type { RunSummary } from "../repository/types.js";

export function buildFoundryToolServer(
  projectId: string,
  repo: IFoundryRepository,
  runId: string
) {
  // Track run stats for the summary
  let decisionsMade = 0;
  let escalationsCreated = 0;
  let actionsExecuted = 0;

  const server = createSdkMcpServer({
    name: "foundry",
    version: "1.0.0",
    tools: [
      // ── 1. get_project_context ──────────────────────────────────
      tool(
        "get_project_context",
        "Load the full current state of the project: brief, all decisions to date, open escalations, and available capabilities. Call this first on every run.",
        {
          project_id: z.string().describe("The project ID"),
        },
        async ({ project_id }) => {
          const project = repo.projects.get(project_id);
          if (!project) {
            return {
              content: [
                { type: "text" as const, text: `Error: project not found: ${project_id}` },
              ],
            };
          }

          const decisions = repo.decisions.query({ projectId: project_id });
          const openEscalations = repo.escalations.getOpen(project_id);
          const projectCapabilities = repo.capabilities.listForProject(project_id);

          const capabilitiesWithActions = projectCapabilities.map((pc) => {
            const def = repo.capabilities.getDefinition(pc.capabilityId);
            if (!def) return null;
            const actions = repo.capabilities.listActions(pc.capabilityId);
            return {
              id: pc.id,
              name: def.name,
              category: def.category,
              status: pc.status,
              actions: actions.map((a) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                requiresApproval: a.requiresApproval,
                isDestructive: a.isDestructive,
              })),
            };
          }).filter(Boolean);

          const context = {
            brief: project.brief,
            decisions,
            open_escalations: openEscalations,
            capabilities: capabilitiesWithActions,
          };

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(context, null, 2) },
            ],
          };
        }
      ),

      // ── 2. log_decision ─────────────────────────────────────────
      tool(
        "log_decision",
        "Record an autonomous decision to the decision log. Use for decisions you can make without founder input: technical tradeoffs, conventions, sequencing, standard approaches.",
        {
          project_id: z.string(),
          domain: z
            .enum(["product", "engineering", "marketing", "business", "design"])
            .describe("Decision domain"),
          topic: z.string().describe("Short topic identifier, e.g. 'database-choice'"),
          decision: z.string().describe("The decision made, stated concretely"),
          rationale: z
            .string()
            .describe("Why this decision was made. What was weighed."),
          alternatives: z
            .array(
              z.object({
                option: z.string(),
                tradeoff: z.string(),
              })
            )
            .describe("Alternatives considered and their tradeoffs"),
          impact: z.enum(["low", "medium", "high"]),
          reversibility: z.enum(["easy", "hard", "permanent"]),
          supersedes: z
            .string()
            .optional()
            .describe("ID of a prior decision this supersedes"),
          tags: z.array(z.string()).optional(),
        },
        async (args) => {
          const decision = repo.decisions.append({
            projectId: args.project_id,
            domain: args.domain,
            topic: args.topic,
            decision: args.decision,
            rationale: args.rationale,
            alternatives: args.alternatives,
            madeBy: "agent",
            impact: args.impact,
            reversibility: args.reversibility,
            ...(args.supersedes !== undefined && { supersedes: args.supersedes }),
            ...(args.tags !== undefined && { tags: args.tags }),
          });

          repo.activity.append(args.project_id, "decision-made", {
            decisionId: decision.id,
            domain: args.domain,
            topic: args.topic,
            impact: args.impact,
            runId,
          });

          decisionsMade++;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, decision_id: decision.id }),
              },
            ],
          };
        }
      ),

      // ── 3. create_escalation ────────────────────────────────────
      tool(
        "create_escalation",
        "Escalate a decision to the founder. Use when the decision requires founder input: personal preferences, budget, strategic bets, or information you don't have. Always include your recommendation — the founder approves or overrides, they do not research from scratch.",
        {
          project_id: z.string(),
          domain: z.enum(["product", "engineering", "marketing", "business", "design"]),
          topic: z.string().describe("Short topic identifier"),
          draft_decision: z.string().describe("Your recommendation"),
          draft_rationale: z.string().describe("Why you recommend this"),
          draft_alternatives: z.array(
            z.object({ option: z.string(), tradeoff: z.string() })
          ),
          impact: z.enum(["low", "medium", "high"]),
          timeout_hours: z
            .number()
            .optional()
            .describe("Hours before auto-accepting the draft (default 48)"),
        },
        async (args) => {
          const escalation = repo.escalations.create({
            projectId: args.project_id,
            domain: args.domain,
            topic: args.topic,
            draftDecision: args.draft_decision,
            draftRationale: args.draft_rationale,
            draftAlternatives: args.draft_alternatives,
            impact: args.impact,
            ...(args.timeout_hours !== undefined && { timeoutHours: args.timeout_hours }),
          });

          repo.activity.append(args.project_id, "escalation-created", {
            escalationId: escalation.id,
            domain: args.domain,
            topic: args.topic,
            impact: args.impact,
            timeoutAt: escalation.timeoutAt,
            runId,
          });

          escalationsCreated++;

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  escalation_id: escalation.id,
                  timeout_at: escalation.timeoutAt,
                }),
              },
            ],
          };
        }
      ),

      // ── 4. execute_capability_action ────────────────────────────
      tool(
        "execute_capability_action",
        "Execute a configured capability action (deploy, post, create-issue, etc.). If the capability is not configured, an escalation is created automatically with setup instructions. If the action requires approval, an escalation is created and the action waits.",
        {
          project_capability_id: z
            .string()
            .describe("The project capability instance ID (from get_project_context)"),
          action_name: z.string().describe("The action name to execute"),
          params: z
            .record(z.string(), z.string())
            .describe("Parameters for the action")
            .default({}),
        },
        async ({ project_capability_id, action_name, params }) => {
          const pc = repo.capabilities.getProjectCapability(project_capability_id);
          if (!pc) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: `Project capability not found: ${project_capability_id}`,
                  }),
                },
              ],
            };
          }

          // Not configured — escalate with setup guide
          if (pc.status === "pending") {
            const def = repo.capabilities.getDefinition(pc.capabilityId);
            const escalation = repo.escalations.create({
              projectId: pc.projectId,
              domain: "engineering",
              topic: `configure-${def?.name ?? pc.capabilityId}`,
              draftDecision: `Configure the ${def?.name ?? "capability"} integration`,
              draftRationale: `The agent needs to run "${action_name}" but the capability is not yet configured. Setup instructions are included.`,
              draftAlternatives: [],
              impact: "medium",
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    escalation_created: true,
                    escalation_id: escalation.id,
                    reason: "Capability not configured",
                    setup_guide: def?.setupGuide,
                  }),
                },
              ],
            };
          }

          // Check if action requires approval
          const actions = repo.capabilities.listActions(pc.capabilityId);
          const action = actions.find((a) => a.name === action_name);
          if (action?.requiresApproval) {
            const def = repo.capabilities.getDefinition(pc.capabilityId);
            const escalation = repo.escalations.create({
              projectId: pc.projectId,
              domain: "engineering",
              topic: `approve-${def?.name ?? pc.capabilityId}-${action_name}`,
              draftDecision: `Execute ${action_name} on ${def?.name ?? "capability"}`,
              draftRationale: `This action is marked as requiring approval. Params: ${JSON.stringify(params)}`,
              draftAlternatives: [],
              impact: action.isDestructive ? "high" : "medium",
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    approval_pending: true,
                    escalation_id: escalation.id,
                  }),
                },
              ],
            };
          }

          try {
            const result = await repo.capabilities.execute(
              project_capability_id,
              action_name,
              params as Record<string, string>,
              "agent"
            );

            repo.activity.append(pc.projectId, "capability-executed", {
              projectCapabilityId: project_capability_id,
              actionName: action_name,
              status: result.status,
              runId,
            });

            actionsExecuted++;

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: result.status === "success",
                    output: result.output,
                    error: result.error,
                    duration_ms: result.durationMs,
                  }),
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ error: String(err) }),
                },
              ],
            };
          }
        }
      ),

      // ── 5. snapshot_code ────────────────────────────────────────
      tool(
        "snapshot_code",
        "Create a git bundle snapshot of a code repository. Call this before and after deployments, and at the end of any run where code was changed.",
        {
          project_id: z.string(),
          repo_path: z.string().describe("Absolute path to the git repository"),
          trigger: z
            .string()
            .describe(
              "What triggered this snapshot: 'pre-deploy', 'post-deploy', 'agent-run-complete', 'manual'"
            ),
        },
        async ({ project_id, repo_path, trigger }) => {
          try {
            const artifact = await repo.artifacts.snapshotCode(
              project_id,
              repo_path,
              trigger
            );

            repo.activity.append(project_id, "artifact-created", {
              artifactId: artifact.id,
              type: "git-bundle",
              trigger,
              runId,
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: true,
                    artifact_id: artifact.id,
                    content_size: artifact.contentSize,
                    content_hash: artifact.contentHash,
                  }),
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ error: String(err) }),
                },
              ],
            };
          }
        }
      ),
    ],
  });

  return {
    mcpConfig: server,
    getSummary(): RunSummary {
      return {
        decisionsMade,
        escalationsCreated,
        actionsExecuted,
        summary: `Made ${decisionsMade} decision(s), created ${escalationsCreated} escalation(s), executed ${actionsExecuted} action(s).`,
      };
    },
  };
}
