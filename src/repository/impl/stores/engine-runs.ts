import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { engineRuns } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type { EngineRun, EngineRunStatus, RunSummary } from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class EngineRunStore {
  constructor(private readonly db: DB) {}

  start(projectId: string): EngineRun {
    const id = randomUUID();
    const startedAt = new Date().toISOString();

    this.db.insert(engineRuns).values({
      id,
      projectId,
      startedAt,
      status: "running",
      decisionsMade: 0,
      escalationsCreated: 0,
      actionsExecuted: 0,
    }).run();

    return this.getOrThrow(id);
  }

  complete(runId: string, summary: RunSummary): void {
    this.db
      .update(engineRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: "complete",
        decisionsMade: summary.decisionsMade,
        escalationsCreated: summary.escalationsCreated,
        actionsExecuted: summary.actionsExecuted,
        summary: summary.summary,
      })
      .where(eq(engineRuns.id, runId))
      .run();
  }

  fail(runId: string, error: string): void {
    this.db
      .update(engineRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: "failed",
        error,
      })
      .where(eq(engineRuns.id, runId))
      .run();
  }

  getCurrent(projectId: string): EngineRun | null {
    const row = this.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.projectId, projectId))
      .orderBy(desc(engineRuns.startedAt))
      .limit(1)
      .get();

    if (!row || row.status !== "running") return null;
    return rowToRun(row);
  }

  getLastCompleted(projectId: string): EngineRun | null {
    const row = this.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.projectId, projectId))
      .orderBy(desc(engineRuns.startedAt))
      .all()
      .find((r) => r.status === "complete");

    return row ? rowToRun(row) : null;
  }

  recoverStalledRuns(): number {
    const stalled = this.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.status, "running"))
      .all();

    for (const run of stalled) {
      this.db
        .update(engineRuns)
        .set({
          status: "recovered",
          completedAt: new Date().toISOString(),
          error: "Recovered on startup — process was killed mid-run",
        })
        .where(eq(engineRuns.id, run.id))
        .run();
    }

    return stalled.length;
  }

  private getOrThrow(id: string): EngineRun {
    const row = this.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id))
      .get();
    if (!row) throw new Error(`EngineRun not found: ${id}`);
    return rowToRun(row);
  }
}

function rowToRun(row: typeof engineRuns.$inferSelect): EngineRun {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    status: row.status as EngineRunStatus,
    decisionsMade: row.decisionsMade ?? 0,
    escalationsCreated: row.escalationsCreated ?? 0,
    actionsExecuted: row.actionsExecuted ?? 0,
    summary: row.summary ?? null,
    error: row.error ?? null,
  };
}
