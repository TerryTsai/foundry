import { eq, and, desc, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { decisions } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type {
  Decision,
  NewDecision,
  DecisionFilter,
  DecisionDomain,
  DecisionImpact,
  DecisionMadeBy,
  DecisionReversibility,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class DecisionStore {
  constructor(private readonly db: DB) {}

  // APPEND ONLY — no update/delete methods exposed.
  append(d: NewDecision): Decision {
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    if (d.supersedes) {
      const prior = this.db
        .select()
        .from(decisions)
        .where(eq(decisions.id, d.supersedes))
        .get();
      if (!prior) throw new Error(`supersedes target not found: ${d.supersedes}`);
    }

    this.db.insert(decisions).values({
      id,
      projectId: d.projectId,
      timestamp,
      domain: d.domain,
      topic: d.topic,
      decision: d.decision,
      rationale: d.rationale,
      alternatives: d.alternatives ? JSON.stringify(d.alternatives) : null,
      madeBy: d.madeBy,
      impact: d.impact,
      reversibility: d.reversibility,
      supersedes: d.supersedes ?? null,
      tags: d.tags ? JSON.stringify(d.tags) : null,
    }).run();

    return this.getOrThrow(id);
  }

  query(filter: DecisionFilter): Decision[] {
    const conditions = [eq(decisions.projectId, filter.projectId)];

    if (filter.domain) conditions.push(eq(decisions.domain, filter.domain));
    if (filter.impact) conditions.push(eq(decisions.impact, filter.impact));
    if (filter.madeBy) conditions.push(eq(decisions.madeBy, filter.madeBy));
    if (filter.since) {
      conditions.push(sql`${decisions.timestamp} >= ${filter.since}`);
    }

    const rows = this.db
      .select()
      .from(decisions)
      .where(and(...conditions))
      .orderBy(desc(decisions.timestamp))
      .all();

    return rows.map(rowToDecision);
  }

  // Latest decision per unique (domain, topic) — resolves supersedes chains.
  latestPerTopic(projectId: string, domain?: DecisionDomain): Decision[] {
    // Subquery: for each (domain, topic), get max timestamp
    const filter: DecisionFilter = { projectId };
    if (domain !== undefined) filter.domain = domain;
    const all = this.query(filter);

    const seen = new Map<string, Decision>();
    for (const d of all) {
      const key = `${d.domain}::${d.topic}`;
      if (!seen.has(key)) seen.set(key, d); // already ordered desc
    }

    return Array.from(seen.values());
  }

  getHistory(projectId: string, topic: string): Decision[] {
    const rows = this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.projectId, projectId), eq(decisions.topic, topic)))
      .orderBy(desc(decisions.timestamp))
      .all();

    return rows.map(rowToDecision);
  }

  private getOrThrow(id: string): Decision {
    const row = this.db
      .select()
      .from(decisions)
      .where(eq(decisions.id, id))
      .get();
    if (!row) throw new Error(`Decision not found: ${id}`);
    return rowToDecision(row);
  }
}

function rowToDecision(row: typeof decisions.$inferSelect): Decision {
  return {
    id: row.id,
    projectId: row.projectId,
    timestamp: row.timestamp,
    domain: row.domain as DecisionDomain,
    topic: row.topic,
    decision: row.decision,
    rationale: row.rationale,
    alternatives: row.alternatives
      ? (JSON.parse(row.alternatives) as Array<{ option: string; tradeoff: string }>)
      : null,
    madeBy: row.madeBy as DecisionMadeBy,
    impact: row.impact as DecisionImpact,
    reversibility: row.reversibility as DecisionReversibility,
    supersedes: row.supersedes ?? null,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : null,
  };
}
