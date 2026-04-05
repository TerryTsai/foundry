// Project tools: resolves capability actions declared in agent's tools[]
// into MCP tools that call repo.capabilities.execute().

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { IFoundryRepository } from '../../repository/index.js';
import type { AgentDefinition } from '../../repository/types.js';

export const SYSTEM_TOOL_NAMES = [
  'read_artifact',
  'write_artifact',
  'create_task',
  'run_command',
  'read_file',
  'write_file',
];

export function buildProjectTools(
  agentDef: AgentDefinition,
  projectId: string,
  repo: IFoundryRepository,
) {
  const projectTools = [];

  // Get all project capabilities and their actions for this project
  const projectCapabilities = repo.capabilities.listForProject(projectId);

  for (const toolName of agentDef.tools) {
    // Skip system/compute tools — they're handled elsewhere
    if (SYSTEM_TOOL_NAMES.includes(toolName)) continue;

    // Find a matching capability action
    let foundCapabilityId: string | null = null;
    let foundActionName: string | null = null;
    let foundDescription = `Execute ${toolName}`;

    for (const pc of projectCapabilities) {
      const actions = repo.capabilities.listActions(pc.capabilityId);
      const action = actions.find((a) => a.name === toolName);
      if (action) {
        foundCapabilityId = pc.id;
        foundActionName = action.name;
        foundDescription = action.description;
        break;
      }
    }

    if (!foundCapabilityId || !foundActionName) {
      // Tool declared but no matching capability action — skip silently
      continue;
    }

    const capId = foundCapabilityId;
    const actionName = foundActionName;

    const projectTool = tool(
      toolName,
      foundDescription,
      // Use record schema as fallback — agents pass string params
      { params: z.record(z.string(), z.string()).describe('Parameters for this action') },
      async (args) => {
        try {
          const result = await repo.capabilities.execute(capId, actionName, args.params, 'agent');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  success: result.status === 'success',
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
                type: 'text' as const,
                text: JSON.stringify({ error: String(err) }),
              },
            ],
          };
        }
      },
    );

    projectTools.push(projectTool);
  }

  return projectTools;
}
