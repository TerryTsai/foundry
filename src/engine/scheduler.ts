import type { IFoundryRepository } from "../repository/index.js";
import type { Project } from "../repository/types.js";
import { runEngine } from "./engine.js";

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
    const recovered = this.repo.engineRuns.recoverStalledRuns();
    if (recovered > 0) {
      console.log(`[scheduler] Recovered ${recovered} stalled run(s)`);
    }

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        console.error("[scheduler] tick error:", err);
      });
    }, this.config.intervalMs);

    console.log(
      `[scheduler] Started — interval ${this.config.intervalMs / 1000}s`
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(projectId: string): Promise<void> {
    const project = this.repo.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    await this.runProject(project);
  }

  private async tick(): Promise<void> {
    const active = this.repo.projects.list("active");
    const runnable: Project[] = [];

    for (const project of active) {
      if (await this.needsRun(project)) {
        runnable.push(project);
      }
    }

    const batch = runnable.slice(0, this.config.maxParallel);
    if (batch.length === 0) return;

    console.log(
      `[scheduler] Scheduling ${batch.length} project run(s): ${batch.map((p) => p.name).join(", ")}`
    );

    await Promise.all(
      batch.map((p) =>
        this.runProject(p).catch((err: unknown) => {
          console.error(`[scheduler] run failed for project ${p.id}:`, err);
        })
      )
    );
  }

  private async needsRun(project: Project): Promise<boolean> {
    const current = this.repo.engineRuns.getCurrent(project.id);
    if (current?.status === "running") return false;

    const last = this.repo.engineRuns.getLastCompleted(project.id);
    if (!last) return true;

    const elapsed = Date.now() - new Date(last.completedAt!).getTime();
    return elapsed > this.config.intervalMs;
  }

  private async runProject(project: Project): Promise<void> {
    console.log(`[engine] Starting run for project: ${project.name}`);
    try {
      const summary = await runEngine(project, this.repo);
      console.log(
        `[engine] Run complete for ${project.name}: ${summary.summary}`
      );
    } catch (err) {
      console.error(`[engine] Run failed for ${project.name}:`, err);
    }
  }
}
