import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { loopRuns } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type { EngineRun, EngineRunStatus, RunSummary } from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class LoopRunStore {
  constructor(private readonly db: DB) {}

  start(projectId: string): EngineRun {
    const id = randomUUID();
    this.db.insert(loopRuns).values({
      id,
      projectId,
      startedAt: new Date().toISOString(),
      status: "running",
      tasksDispatched: 0,
    }).run();
    return this.getOrThrow(id);
  }

  complete(runId: string, summary: RunSummary): void {
    this.db
      .update(loopRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: "complete",
        tasksDispatched: summary.tasksDispatched,
        summary: summary.summary,
      })
      .where(eq(loopRuns.id, runId))
      .run();
  }

  fail(runId: string, error: string): void {
    this.db
      .update(loopRuns)
      .set({ completedAt: new Date().toISOString(), status: "failed", error })
      .where(eq(loopRuns.id, runId))
      .run();
  }

  getCurrent(projectId: string): EngineRun | null {
    const row = this.db
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.projectId, projectId))
      .orderBy(desc(loopRuns.startedAt))
      .limit(1)
      .get();
    if (!row || row.status !== "running") return null;
    return rowToRun(row);
  }

  getLastCompleted(projectId: string): EngineRun | null {
    const row = this.db
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.projectId, projectId))
      .orderBy(desc(loopRuns.startedAt))
      .all()
      .find((r) => r.status === "complete");
    return row ? rowToRun(row) : null;
  }

  recoverStalledRuns(): number {
    const stalled = this.db
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.status, "running"))
      .all();
    for (const run of stalled) {
      this.db
        .update(loopRuns)
        .set({
          status: "recovered",
          completedAt: new Date().toISOString(),
          error: "Recovered on startup — process was killed mid-run",
        })
        .where(eq(loopRuns.id, run.id))
        .run();
    }
    return stalled.length;
  }

  private getOrThrow(id: string): EngineRun {
    const row = this.db.select().from(loopRuns).where(eq(loopRuns.id, id)).get();
    if (!row) throw new Error(`LoopRun not found: ${id}`);
    return rowToRun(row);
  }
}

function rowToRun(row: typeof loopRuns.$inferSelect): EngineRun {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    status: row.status as EngineRunStatus,
    tasksDispatched: row.tasksDispatched ?? 0,
    summary: row.summary ?? null,
    error: row.error ?? null,
  };
}
