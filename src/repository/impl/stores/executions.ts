import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { capabilityExecutions } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type { CapabilityExecution, ExecutionStatus } from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

// Read-only view of executions — writes happen inside CapabilityStore.execute().
export class ExecutionStore {
  constructor(private readonly db: DB) {}

  list(projectCapabilityId: string, limit = 50): CapabilityExecution[] {
    const rows = this.db
      .select()
      .from(capabilityExecutions)
      .where(eq(capabilityExecutions.projectCapabilityId, projectCapabilityId))
      .orderBy(desc(capabilityExecutions.executedAt))
      .limit(limit)
      .all();

    return rows.map(rowToExecution);
  }
}

function rowToExecution(
  row: typeof capabilityExecutions.$inferSelect
): CapabilityExecution {
  return {
    id: row.id,
    projectCapabilityId: row.projectCapabilityId,
    actionId: row.actionId,
    params: row.params
      ? (JSON.parse(row.params) as Record<string, string>)
      : null,
    triggeredBy: row.triggeredBy as "agent" | "founder-test",
    executedAt: row.executedAt,
    status: row.status as ExecutionStatus,
    output: row.output ?? null,
    error: row.error ?? null,
    durationMs: row.durationMs ?? null,
  };
}
