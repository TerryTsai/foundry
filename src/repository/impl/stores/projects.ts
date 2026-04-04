import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { projects } from "../schema/index.js";
import type * as schema from "../schema/index.js";
import type { Project, ProjectBrief, ProjectStatus } from "../../types.js";

type DB = BetterSQLite3Database<typeof schema>;

export class ProjectStore {
  constructor(private readonly db: DB) {}

  create(brief: ProjectBrief & { name: string; slug: string }): Project {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.insert(projects).values({
      id,
      name: brief.name,
      slug: brief.slug,
      status: "active",
      brief: JSON.stringify(brief),
      createdAt,
    }).run();

    return this.getOrThrow(id);
  }

  get(id: string): Project | null {
    const row = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get();

    return row ? rowToProject(row) : null;
  }

  list(status?: ProjectStatus): Project[] {
    const rows = status
      ? this.db.select().from(projects).where(eq(projects.status, status)).all()
      : this.db.select().from(projects).all();

    return rows.map(rowToProject);
  }

  updateStatus(id: string, status: ProjectStatus): void {
    this.db
      .update(projects)
      .set({ status })
      .where(eq(projects.id, id))
      .run();
  }

  updateBrief(id: string, brief: ProjectBrief): void {
    this.db
      .update(projects)
      .set({ brief: JSON.stringify(brief) })
      .where(eq(projects.id, id))
      .run();
  }

  private getOrThrow(id: string): Project {
    const p = this.get(id);
    if (!p) throw new Error(`Project not found: ${id}`);
    return p;
  }
}

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as ProjectStatus,
    brief: JSON.parse(row.brief) as ProjectBrief,
    createdAt: row.createdAt,
  };
}
