import { eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { escalations, activityLog } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type {
  Escalation,
  NewEscalation,
  EscalationResolution,
  DecisionDomain,
  DecisionImpact,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

const DEFAULT_TIMEOUT_HOURS = 48;

export class EscalationStore {
  constructor(private readonly db: DB) {}

  create(e: NewEscalation): Escalation {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const timeoutMs =
      (e.timeoutHours ?? DEFAULT_TIMEOUT_HOURS) * 60 * 60 * 1000;
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

    this.db.insert(escalations).values({
      id,
      projectId: e.projectId,
      domain: e.domain,
      topic: e.topic,
      draftDecision: e.draftDecision,
      draftRationale: e.draftRationale,
      draftAlternatives: e.draftAlternatives
        ? JSON.stringify(e.draftAlternatives)
        : null,
      impact: e.impact,
      createdAt,
      timeoutAt,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    }).run();

    this.appendActivity(e.projectId, id, "escalation-created", {
      topic: e.topic,
      domain: e.domain,
    });

    return this.getOrThrow(id);
  }

  getOpen(projectId: string): Escalation[] {
    const rows = this.db
      .select()
      .from(escalations)
      .where(eq(escalations.projectId, projectId))
      .all()
      .filter((r) => r.resolvedAt === null);

    return rows.map(rowToEscalation);
  }

  get(id: string): Escalation | null {
    const row = this.db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id))
      .get();

    return row ? rowToEscalation(row) : null;
  }

  resolve(id: string, resolution: EscalationResolution): void {
    const existing = this.getOrThrow(id);
    if (existing.resolvedAt !== null) {
      throw new Error(`Escalation ${id} is already resolved`);
    }

    const resolvedAt = new Date().toISOString();
    this.db
      .update(escalations)
      .set({
        resolvedAt,
        resolvedBy: resolution.resolvedBy,
        resolution: resolution.resolution ?? null,
      })
      .where(eq(escalations.id, id))
      .run();

    this.appendActivity(existing.projectId, id, "escalation-resolved", {
      resolvedBy: resolution.resolvedBy,
      topic: existing.topic,
    });
  }

  private getOrThrow(id: string): Escalation {
    const e = this.get(id);
    if (!e) throw new Error(`Escalation not found: ${id}`);
    return e;
  }

  private appendActivity(
    projectId: string,
    escalationId: string,
    event: "escalation-created" | "escalation-resolved",
    detail: Record<string, unknown>
  ): void {
    this.db.insert(activityLog).values({
      id: randomUUID(),
      projectId,
      timestamp: new Date().toISOString(),
      event,
      detail: JSON.stringify({ escalationId, ...detail }),
    }).run();
  }
}

function rowToEscalation(row: typeof escalations.$inferSelect): Escalation {
  return {
    id: row.id,
    projectId: row.projectId,
    domain: row.domain as DecisionDomain,
    topic: row.topic,
    draftDecision: row.draftDecision,
    draftRationale: row.draftRationale,
    draftAlternatives: row.draftAlternatives
      ? (JSON.parse(row.draftAlternatives) as Array<{
          option: string;
          tradeoff: string;
        }>)
      : null,
    impact: row.impact as DecisionImpact,
    createdAt: row.createdAt,
    timeoutAt: row.timeoutAt,
    resolvedAt: row.resolvedAt ?? null,
    resolvedBy: (row.resolvedBy as "ceo" | "timeout" | null) ?? null,
    resolution: row.resolution ?? null,
  };
}
