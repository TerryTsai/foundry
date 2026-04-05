// Agent context: builds system prompt, initial prompt, and tool server for an agent session.

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { IFoundryRepository } from '../repository/index.js';
import type { Task, AgentDefinition, ProjectConfig } from '../repository/types.js';
import { buildSystemTools } from './tools/system.js';
import { buildComputeTools } from './tools/compute.js';
import { buildProjectTools, SYSTEM_TOOL_NAMES } from './tools/project.js';

const LARGE_ARTIFACT_THRESHOLD = 10_000; // bytes

export interface AgentContext {
  taskId: string;
  projectId: string;
  systemPrompt: string;
  initialPrompt: string;
  agentDef: AgentDefinition;
  config: ProjectConfig;
}

export function buildAgentContext(
  task: Task,
  agentDef: AgentDefinition,
  config: ProjectConfig,
  repo: IFoundryRepository,
): AgentContext {
  const project = repo.projects.get(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const systemPrompt = buildSystemPrompt(task, agentDef, config, project.brief);
  const initialPrompt = buildInitialPrompt(task, repo);

  return {
    taskId: task.id,
    projectId: task.projectId,
    systemPrompt,
    initialPrompt,
    agentDef,
    config,
  };
}

function buildSystemPrompt(
  task: Task,
  agentDef: AgentDefinition,
  config: ProjectConfig,
  brief: { tagline: string; problem: string; mvp: string },
): string {
  const lines: string[] = [];

  // Agent's own prompt
  if (agentDef.prompt) {
    lines.push(agentDef.prompt);
    lines.push('');
  }

  // Colleagues
  const colleagues = config.agents.filter((a) => a.name !== agentDef.name);
  if (colleagues.length > 0) {
    lines.push('## Colleagues');
    for (const colleague of colleagues) {
      lines.push(`- **${colleague.name}**: consumes [${colleague.consumes.join(', ')}], produces [${colleague.produces.join(', ')}]`);
    }
    lines.push('');
  }

  // Declared outputs
  const successOutputs = task.outputs.filter((o) => !o.isFailure);
  const failureOutput = task.outputs.find((o) => o.isFailure === true);

  if (successOutputs.length > 0) {
    lines.push('## Your outputs');
    lines.push('You must produce the following artifacts by calling `write_artifact`:');
    for (const output of successOutputs) {
      lines.push(`- **${output.name}** (type: \`${output.type}\`)`);
    }
    lines.push('');
  }

  if (failureOutput) {
    lines.push('## Failure handling');
    lines.push(
      `If you cannot complete this task, produce the failure artifact **${failureOutput.name}** (type: \`${failureOutput.type}\`) instead, ` +
      `and call \`create_task\` to dispatch a recovery agent.`,
    );
    lines.push('');
  }

  // Tool notes
  lines.push('## Tool notes');
  lines.push('- `write_artifact` returns `{ artifact_id }` — use it in `create_task` inputs.');
  lines.push(`- Workspace path: \`${config.workspace}\``);
  lines.push('');

  // Project context
  lines.push('## Project');
  lines.push(`**Goal**: ${brief.tagline}`);
  lines.push(`**Problem**: ${brief.problem}`);
  lines.push(`**MVP**: ${brief.mvp}`);

  // Head (inputs defined at project level)
  if (config.head.length > 0) {
    lines.push('');
    lines.push('**Project head** (source artifact types):');
    for (const h of config.head) {
      lines.push(`- ${h.name} (${h.type})`);
    }
  }

  // Tail (goal outputs at project level)
  if (config.tail.length > 0) {
    lines.push('');
    lines.push('**Project goal** (target artifact types to deliver):');
    for (const t of config.tail) {
      lines.push(`- ${t.name} (${t.type})`);
    }
  }

  return lines.join('\n');
}

function buildInitialPrompt(task: Task, repo: IFoundryRepository): string {
  const lines: string[] = [];

  lines.push(`Your task: ${task.id}`);
  lines.push(`Description: ${task.description}`);
  lines.push('');

  if (task.inputs.length > 0) {
    lines.push('## Input artifacts');
    lines.push('');

    for (const input of task.inputs) {
      try {
        const artifact = repo.artifacts.get(input.artifact_id);
        lines.push(`## ${input.name} (${artifact.type})`);
        lines.push(`artifact_id: ${artifact.id}`);
        lines.push('');

        if (artifact.contentSize > LARGE_ARTIFACT_THRESHOLD) {
          lines.push('[large artifact — call read_artifact to retrieve full content]');
        } else {
          lines.push(artifact.content.toString('utf8'));
        }
        lines.push('');
      } catch {
        lines.push(`## ${input.name}`);
        lines.push(`artifact_id: ${input.artifact_id}`);
        lines.push('');
        lines.push('[artifact unavailable]');
        lines.push('');
      }
    }
  }

  lines.push('Begin.');

  return lines.join('\n');
}

export function buildToolServer(
  context: AgentContext,
  repo: IFoundryRepository,
): { mcpConfig: ReturnType<typeof createSdkMcpServer> } {
  const task = repo.tasks.get(context.taskId);
  if (!task) throw new Error(`Task not found: ${context.taskId}`);

  const tools = [];

  const declaredTools = context.agentDef.tools;

  // System tools
  if (declaredTools.includes('read_artifact') || declaredTools.includes('write_artifact') || declaredTools.includes('create_task')) {
    const systemTools = buildSystemTools(task, context.projectId, context.config, repo);
    if (declaredTools.includes('read_artifact')) tools.push(systemTools.readArtifact);
    if (declaredTools.includes('write_artifact')) tools.push(systemTools.writeArtifact);
    if (declaredTools.includes('create_task')) tools.push(systemTools.createTask);
  }

  // Compute tools
  const hasComputeTools = declaredTools.some((t) =>
    ['run_command', 'read_file', 'write_file'].includes(t),
  );
  if (hasComputeTools) {
    const computeTools = buildComputeTools(context.config.workspace);
    if (declaredTools.includes('run_command')) tools.push(computeTools.runCommand);
    if (declaredTools.includes('read_file')) tools.push(computeTools.readFile);
    if (declaredTools.includes('write_file')) tools.push(computeTools.writeFile);
  }

  // Project tools (capability actions)
  const hasProjectTools = declaredTools.some((t) => !SYSTEM_TOOL_NAMES.includes(t));
  if (hasProjectTools) {
    const projectTools = buildProjectTools(context.agentDef, context.projectId, repo);
    tools.push(...projectTools);
  }

  const mcpConfig = createSdkMcpServer({
    name: 'foundry',
    version: '1.0.0',
    tools,
  });

  return { mcpConfig };
}
