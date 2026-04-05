// Replaces src/engine/scheduler.ts
// Ticks on interval, finds active projects, dispatches routable tasks

import type { IFoundryRepository } from '../repository/index.js';
import type { Project } from '../repository/types.js';
import type { ActivityEvent } from '../repository/types.js';
import { dispatch } from './router.js';

export interface SchedulerConfig {
  intervalMs: number;
  maxParallel: number;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: SchedulerConfig,
    private readonly repo: IFoundryRepository
  ) {}

  start(): void {
    const recoveredRuns = this.repo.loopRuns.recoverStalledRuns();
    const recoveredTasks = this.repo.tasks.recoverStalledTasks();
    if (recoveredRuns > 0) console.log(`[scheduler] Recovered ${recoveredRuns} stalled run(s)`);
    if (recoveredTasks > 0) console.log(`[scheduler] Recovered ${recoveredTasks} stalled task(s)`);

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => console.error('[scheduler] tick error:', err));
    }, this.config.intervalMs);

    console.log(`[scheduler] Started — interval ${this.config.intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async runNow(projectId: string): Promise<void> {
    const project = this.repo.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    await this.runProject(project);
  }

  private async tick(): Promise<void> {
    const active = this.repo.projects.list('active');
    const batch = active.slice(0, this.config.maxParallel);
    if (batch.length === 0) return;
    await Promise.all(batch.map(p => this.runProject(p).catch((err: unknown) => {
      console.error(`[scheduler] run failed for project ${p.id}:`, err);
    })));
  }

  private async runProject(project: Project): Promise<void> {
    // Don't start a new loop run if one is already running
    const current = this.repo.loopRuns.getCurrent(project.id);
    if (current?.status === 'running') return;

    const run = this.repo.loopRuns.start(project.id);
    this.repo.activity.append(
      project.id,
      'loop-run-started' as ActivityEvent,
      { runId: run.id }
    );

    try {
      const routable = this.repo.tasks.findRoutable(project.id);
      let dispatched = 0;

      for (const task of routable) {
        await dispatch(task, project, this.repo);
        dispatched++;
      }

      this.repo.loopRuns.complete(run.id, {
        decisionsMade: 0,
        escalationsCreated: 0,
        actionsExecuted: dispatched,
        summary: `Dispatched ${dispatched} task(s)`,
      });
      this.repo.activity.append(
        project.id,
        'loop-run-complete' as ActivityEvent,
        { runId: run.id, tasksDispatched: dispatched }
      );
    } catch (err) {
      const errorMessage = String(err);
      this.repo.loopRuns.fail(run.id, errorMessage);
      this.repo.activity.append(
        project.id,
        'loop-run-failed' as ActivityEvent,
        { runId: run.id, error: errorMessage }
      );
      throw err;
    }
  }
}
