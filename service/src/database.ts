import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import schema, {
  type Agent, type Comment, type Execution, type Message, type Project, type Provider, type Session, type Ticket,
} from './schema.js'

export type Db = ReturnType<typeof drizzle<typeof schema>>

export const createDatabase = (path: string): Db => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')   // safe with WAL, ~2x faster writes
  sqlite.pragma('cache_size = -64000')    // 64 MB page cache
  sqlite.pragma('temp_store = MEMORY')    // temp tables in RAM
  sqlite.pragma('mmap_size = 268435456')  // 256 MB mmap for faster reads
  sqlite.pragma('busy_timeout = 5000')    // wait 5s on lock instead of failing

  // Indexes — append-mostly workload reads by parent ID. CREATE INDEX IF NOT
  // EXISTS is idempotent so it's safe to run on every startup.
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_session_id    ON message(session_id);
    CREATE INDEX IF NOT EXISTS idx_execution_session_id  ON execution(session_id);
    CREATE INDEX IF NOT EXISTS idx_comment_ticket_id     ON comment(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_ticket_id     ON session(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_agent_id      ON session(agent_id);
    CREATE INDEX IF NOT EXISTS idx_session_started_at    ON session(started_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_project_id     ON ticket(project_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_status         ON ticket(status);
    CREATE INDEX IF NOT EXISTS idx_ticket_project_status ON ticket(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_project_id      ON agent(project_id);
  `)

  return drizzle(sqlite, { schema })
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

const project = {
  get:    (d: Db, id: string) => d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.project).where(and(...conditions)).all() : d.select().from(schema.project).all()) as Project[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.project).values({ ...data, id } as any).run(); return d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.project).set(data as any).where(eq(schema.project.id, id)).run(); return d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project },
  remove: (d: Db, id: string) => { d.delete(schema.project).where(eq(schema.project.id, id)).run() },
}

const provider = {
  get:       (d: Db, id: string) => d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.provider).where(and(...conditions)).all() : d.select().from(schema.provider).all()) as Provider[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.provider).values({ ...data, id } as any).run(); return d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider },
  update:    (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.provider).set(data as any).where(eq(schema.provider.id, id)).run(); return d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider },
  remove:    (d: Db, id: string) => { d.delete(schema.provider).where(eq(schema.provider.id, id)).run() },
  getByName: (d: Db, name: string) => d.select().from(schema.provider).where(eq(schema.provider.name, name)).get() as Provider | undefined,
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

const ticket = {
  get:    (d: Db, id: string) => d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.ticket).where(and(...conditions)).all() : d.select().from(schema.ticket).all()) as Ticket[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.ticket).values({ ...data, id } as any).run(); return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.ticket).set(data as any).where(eq(schema.ticket.id, id)).run(); return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket },
  remove: (d: Db, id: string) => { d.delete(schema.ticket).where(eq(schema.ticket.id, id)).run() },
}

const comment = {
  get:      (d: Db, id: string) => d.select().from(schema.comment).where(eq(schema.comment.id, id)).get() as Comment | undefined,
  all:      (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.comment).where(and(...conditions)).all() : d.select().from(schema.comment).all()) as Comment[],
  insert:   (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.comment).values({ ...data, id } as any).run(); return d.select().from(schema.comment).where(eq(schema.comment.id, id)).get() as Comment },
  byTicket: (d: Db, ticketId: string) => d.select().from(schema.comment).where(eq(schema.comment.ticket_id, ticketId)).orderBy(schema.comment.created_at).all(),
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const agent = {
  get:    (d: Db, id: string) => d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.agent).where(and(...conditions)).all() : d.select().from(schema.agent).all()) as Agent[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.agent).values({ ...data, id } as any).run(); return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.agent).set(data as any).where(eq(schema.agent.id, id)).run(); return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent },
  remove: (d: Db, id: string) => { d.delete(schema.agent).where(eq(schema.agent.id, id)).run() },
}

const session = {
  get:    (d: Db, id: string) => d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.session).where(and(...conditions)).all() : d.select().from(schema.session).all()) as Session[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.session).values({ ...data, id } as any).run(); return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.session).set(data as any).where(eq(schema.session.id, id)).run(); return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session },
  remove: (d: Db, id: string) => { d.delete(schema.session).where(eq(schema.session.id, id)).run() },
  byTicket: (d: Db, ticketId: string) =>
    d.select({
      id: schema.session.id, ticket_id: schema.session.ticket_id, agent_id: schema.session.agent_id,
      agent_name: schema.agent.name, status: schema.session.status, model: schema.session.model,
      error: schema.session.error, tokens_in: schema.session.tokens_in, tokens_out: schema.session.tokens_out,
      cost_usd: schema.session.cost_usd, duration_ms: schema.session.duration_ms,
      step_count: schema.session.step_count, tool_calls: schema.session.tool_calls, finish_reason: schema.session.finish_reason,
      started_at: schema.session.started_at, ended_at: schema.session.ended_at,
    }).from(schema.session).leftJoin(schema.agent, eq(schema.session.agent_id, schema.agent.id))
      .where(eq(schema.session.ticket_id, ticketId)).orderBy(schema.session.started_at).all(),
  listWithAgent: (d: Db) =>
    d.select({
      id: schema.session.id, ticket_id: schema.session.ticket_id, agent_id: schema.session.agent_id,
      agent_name: schema.agent.name, status: schema.session.status, model: schema.session.model,
      error: schema.session.error, tokens_in: schema.session.tokens_in, tokens_out: schema.session.tokens_out,
      cost_usd: schema.session.cost_usd, duration_ms: schema.session.duration_ms,
      step_count: schema.session.step_count, tool_calls: schema.session.tool_calls, finish_reason: schema.session.finish_reason,
      started_at: schema.session.started_at, ended_at: schema.session.ended_at,
    }).from(schema.session).leftJoin(schema.agent, eq(schema.session.agent_id, schema.agent.id))
      .orderBy(schema.session.started_at).all().reverse().slice(0, 200),
}

const message = {
  get:       (d: Db, id: string) => d.select().from(schema.message).where(eq(schema.message.id, id)).get() as Message | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.message).where(and(...conditions)).all() : d.select().from(schema.message).all()) as Message[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.message).values({ ...data, id } as any).run(); return d.select().from(schema.message).where(eq(schema.message.id, id)).get() as Message },
  bySession: (d: Db, sessionId: string) => d.select().from(schema.message).where(eq(schema.message.session_id, sessionId)).all(),
}

const execution = {
  get:       (d: Db, id: string) => d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(schema.execution).where(and(...conditions)).all() : d.select().from(schema.execution).all()) as Execution[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(schema.execution).values({ ...data, id } as any).run(); return d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution },
  update:    (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(schema.execution).set(data as any).where(eq(schema.execution.id, id)).run(); return d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution },
  remove:    (d: Db, id: string) => { d.delete(schema.execution).where(eq(schema.execution.id, id)).run() },
  bySession: (d: Db, sessionId: string) => d.select().from(schema.execution).where(eq(schema.execution.session_id, sessionId)).all(),
}

// ════════════════════════════════════════════════════════════════════════════

const database = { project, provider, ticket, comment, agent, session, message, execution }
export default database
