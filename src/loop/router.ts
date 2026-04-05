// Dispatches a single routable task.
// Knows: founder = no session, open UI task.
// Knows: everything else = run agent session.
// Does NOT know: what decisions are, what failures mean, what artifacts contain.

import type { IFoundryRepository } from '../repository/index.js';
import type { Task, Project } from '../repository/types.js';
import type { ActivityEvent } from '../repository/types.js';
import { buildAgentContext } from '../agents/context.js';
import { runAgentSession } from '../agents/runtime.js';

export async function dispatch(task: Task, project: Project, repo: IFoundryRepository): Promise<void> {
  const config = repo.projectConfig.get(project.id);
  if (!config) throw new Error(`No project config found for: ${project.id}`);

  repo.tasks.claim(task.id);
  repo.activity.append(
    project.id,
    'task-claimed' as ActivityEvent,
    { taskId: task.id, agent: task.agent }
  );

  if (task.agent === 'founder') {
    repo.activity.append(
      project.id,
      'founder-task-surfaced' as ActivityEvent,
      { taskId: task.id }
    );
    return;
    // Task surfaces in UI. No agent session opened.
    // claimed_at stays set — recoverStalledTasks won't clear it until output is written.
  }

  const agentDef = config.agents.find(a => a.name === task.agent);
  if (!agentDef) throw new Error(`Unknown agent '${task.agent}' for project ${project.id}`);

  const context = buildAgentContext(task, agentDef, config, repo);
  await runAgentSession(context, repo);

  repo.activity.append(
    project.id,
    'task-complete' as ActivityEvent,
    { taskId: task.id, agent: task.agent }
  );
}
