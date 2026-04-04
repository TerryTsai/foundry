import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { activityLog } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type { ActivityEntry, ActivityEvent } from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class ActivityStore {
  constructor(private readonly db: DB) {}

  append(
    projectId: string,
    event: ActivityEvent,
    detail: Record<string, unknown>
  ): ActivityEntry {
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    this.db.insert(activityLog).values({
      id,
      projectId,
      timestamp,
      event,
      detail: JSON.stringify(detail),
    }).run();

    return { id, projectId, timestamp, event, detail };
  }

  list(projectId: string, limit = 100): ActivityEntry[] {
    const rows = this.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.projectId, projectId))
      .orderBy(desc(activityLog.timestamp))
      .limit(limit)
      .all();

    return rows.map(rowToEntry);
  }
}

function rowToEntry(row: typeof activityLog.$inferSelect): ActivityEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    timestamp: row.timestamp,
    event: row.event as ActivityEvent,
    detail: JSON.parse(row.detail) as Record<string, unknown>,
  };
}
