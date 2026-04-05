// System tools: read_artifact, write_artifact, create_task
// These are the core data-plane tools available to all agents.

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { IFoundryRepository } from '../../repository/index.js';
import type { Task, ProjectConfig, ArtifactType, TaskOutput } from '../../repository/types.js';

export function buildSystemTools(
  task: Task,
  projectId: string,
  config: ProjectConfig,
  repo: IFoundryRepository,
) {
  const readArtifact = tool(
    'read_artifact',
    'Read the full content of an artifact by its artifact_id.',
    {
      artifact_id: z.string().describe('The artifact ID to read'),
    },
    async (args) => {
      try {
        const artifact = repo.artifacts.get(args.artifact_id);
        const content = artifact.content.toString('utf8');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                type: artifact.type,
                name: artifact.name,
                content,
                metadata: artifact.metadata,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  const writeArtifact = tool(
    'write_artifact',
    'Write an artifact for a declared task output. Validates name and type against task outputs.',
    {
      name: z.string().describe('The output name (must be declared in task outputs)'),
      type: z.string().describe('The artifact type (must match declared type)'),
      content: z.string().describe('The artifact content'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata'),
    },
    async (args) => {
      try {
        // Find the declared output
        const declared = task.outputs.find((o) => o.name === args.name);
        if (!declared) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Output '${args.name}' is not declared in task outputs. Declared outputs: ${task.outputs.map((o) => o.name).join(', ')}`,
                }),
              },
            ],
          };
        }

        if (declared.type !== args.type) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Type mismatch for output '${args.name}': declared '${declared.type}', got '${args.type}'`,
                }),
              },
            ],
          };
        }

        const storeArgs: Parameters<typeof repo.artifacts.store>[0] = {
          projectId,
          type: args.type as ArtifactType,
          name: args.name,
          content: args.content,
          createdBy: 'agent',
          taskId: task.id,
          outputName: args.name,
        };
        if (args.metadata !== undefined) {
          storeArgs.metadata = args.metadata as Record<string, unknown>;
        }
        const artifact = repo.artifacts.store(storeArgs);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ artifact_id: artifact.id }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  const createTask = tool(
    'create_task',
    'Create a new task and dispatch it to an agent. Validates agent exists and output types are producible.',
    {
      agent: z.string().describe('The agent name to assign the task to'),
      description: z.string().describe('Description of what the task should do'),
      inputs: z
        .array(
          z.object({
            name: z.string(),
            artifact_id: z.string(),
          }),
        )
        .describe('Input artifacts for the task'),
      outputs: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            isFailure: z.boolean().optional(),
          }),
        )
        .describe('Expected output artifacts'),
    },
    async (args) => {
      try {
        // Validate agent exists
        const agentDef = config.agents.find((a) => a.name === args.agent);
        if (!agentDef) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Agent '${args.agent}' not found in project config. Available agents: ${config.agents.map((a) => a.name).join(', ')}`,
                }),
              },
            ],
          };
        }

        // Validate all output types are producible by the agent
        for (const output of args.outputs) {
          if (!agentDef.produces.includes(output.type)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: `Agent '${args.agent}' cannot produce type '${output.type}'. Agent produces: ${agentDef.produces.join(', ')}`,
                  }),
                },
              ],
            };
          }
        }

        // Create the task — map outputs to strip undefined from optional fields
        const mappedOutputs: TaskOutput[] = args.outputs.map((o) => {
          const out: TaskOutput = { name: o.name, type: o.type };
          if (o.isFailure === true) out.isFailure = true;
          return out;
        });
        const newTask = repo.tasks.create({
          projectId,
          agent: args.agent,
          description: args.description,
          createdBy: task.id,
          inputs: args.inputs,
          outputs: mappedOutputs,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ task_id: newTask.id }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
        };
      }
    },
  );

  return { readArtifact, writeArtifact, createTask };
}
