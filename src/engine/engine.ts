import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IFoundryRepository } from "../repository/index.js";
import type { Project, RunSummary } from "../repository/types.js";
import { buildEnginePrompt, buildInitialPrompt } from "./prompts.js";
import { buildFoundryToolServer } from "./tools.js";

export async function runEngine(
  project: Project,
  repo: IFoundryRepository
): Promise<RunSummary> {
  const run = repo.engineRuns.start(project.id);

  repo.activity.append(project.id, "engine-run-started", {
    runId: run.id,
  });

  const toolServer = buildFoundryToolServer(project.id, repo, run.id);

  try {
    const q = query({
      prompt: buildInitialPrompt(project),
      options: {
        systemPrompt: buildEnginePrompt(project),
        mcpServers: {
          foundry: toolServer.mcpConfig,
        },
        tools: [],           // disable all built-in tools
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
        persistSession: false,
      },
    });

    for await (const message of q) {
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new Error(
            `Engine session ended with error: ${message.subtype} — ${
              "errors" in message ? message.errors.join("; ") : "unknown"
            }`
          );
        }
        break;
      }
    }

    const summary = toolServer.getSummary();
    repo.engineRuns.complete(run.id, summary);

    repo.activity.append(project.id, "engine-run-complete", {
      runId: run.id,
      decisionsMade: summary.decisionsMade,
      escalationsCreated: summary.escalationsCreated,
      actionsExecuted: summary.actionsExecuted,
    });

    return summary;
  } catch (err) {
    const errorMessage = String(err);
    repo.engineRuns.fail(run.id, errorMessage);

    repo.activity.append(project.id, "engine-run-failed", {
      runId: run.id,
      error: errorMessage,
    });

    throw err;
  }
}
