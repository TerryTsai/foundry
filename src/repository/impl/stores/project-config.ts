import { eq, desc, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { projectConfigs } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type {
  ProjectConfig,
  DagValidationResult,
} from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class ProjectConfigStore {
  constructor(private readonly db: DB) {}

  get(projectId: string): ProjectConfig | null {
    const row = this.db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.projectId, projectId))
      .orderBy(desc(projectConfigs.createdAt), sql`rowid desc`)
      .limit(1)
      .get();

    return row ? (JSON.parse(row.config) as ProjectConfig) : null;
  }

  set(projectId: string, config: ProjectConfig, createdBy: string): ProjectConfig {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.insert(projectConfigs).values({
      id,
      projectId,
      config: JSON.stringify(config),
      createdAt,
      createdBy,
    }).run();

    return config;
  }

  validateDag(config: ProjectConfig): DagValidationResult {
    // Build reachable type set starting from head types
    const reachable = new Set<string>(config.head.map((h) => h.type));

    // Agents that are NOT founders (founders consume/produce '*')
    const regularAgents = config.agents.filter(
      (a) => !(a.consumes.includes("*") || a.produces.includes("*"))
    );

    // Iteratively expand reachable set
    let changed = true;
    while (changed) {
      changed = false;
      for (const agent of regularAgents) {
        // An agent can run if ANY of its consumed types is reachable —
        // consumes[] declares what it accepts, not what it needs simultaneously.
        const anyConsumed = agent.consumes.length === 0 || agent.consumes.some((c) => reachable.has(c));
        if (anyConsumed) {
          for (const p of agent.produces) {
            if (!reachable.has(p)) {
              reachable.add(p);
              changed = true;
            }
          }
        }
      }
    }

    // unreachableTail: tail types not in reachable set
    const unreachableTail = config.tail
      .filter((t) => !reachable.has(t.type))
      .map((t) => t.name);

    // orphanedAgents: agents with NO consumed types in reachable set
    const orphanedAgents = regularAgents
      .filter((a) => a.consumes.length > 0 && !a.consumes.some((c) => reachable.has(c)))
      .map((a) => a.name);

    // missingProducers: tail types that no agent can produce.
    // If any agent produces "*" (i.e. founder), all types are coverable.
    const hasStarProducer = config.agents.some((a) => a.produces.includes("*"));
    const allProduced = new Set<string>(
      config.agents.flatMap((a) => (a.produces.includes("*") ? [] : a.produces))
    );
    const missingProducers = hasStarProducer
      ? []
      : config.tail.filter((t) => !allProduced.has(t.type)).map((t) => t.name);

    const valid = unreachableTail.length === 0 && missingProducers.length === 0;

    return { valid, unreachableTail, orphanedAgents, missingProducers };
  }

  listVersions(projectId: string): ProjectConfig[] {
    const rows = this.db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.projectId, projectId))
      .orderBy(desc(projectConfigs.createdAt), sql`rowid desc`)
      .all();

    return rows.map((r) => JSON.parse(r.config) as ProjectConfig);
  }
}
