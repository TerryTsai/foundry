import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from './schema.js'
import type { Agent, Comment, Execution, Message, Project, Provider, Session, Ticket } from './schema.js'

export type Db = ReturnType<typeof drizzle<typeof schema>>

export function createDatabase(path: string): Db {
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

export function projectGet(d: Db, id: string): Project | undefined {
  return d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project | undefined
}

export function projectAll(d: Db, conditions?: SQL[]): Project[] {
  const q = conditions?.length ? d.select().from(schema.project).where(and(...conditions)) : d.select().from(schema.project)
  return q.all() as Project[]
}

export function projectInsert(d: Db, data: Record<string, unknown>): Project {
  const id = nanoid()
  d.insert(schema.project).values({ ...data, id } as any).run()
  return d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project
}

export function projectUpdate(d: Db, id: string, data: Record<string, unknown>): Project {
  if (Object.keys(data).length > 0) d.update(schema.project).set(data as any).where(eq(schema.project.id, id)).run()
  return d.select().from(schema.project).where(eq(schema.project.id, id)).get() as Project
}

export function projectRemove(d: Db, id: string): void {
  d.delete(schema.project).where(eq(schema.project.id, id)).run()
}

// ────────────────────────────────────────────────────────────────────────────
// PROVIDER
// ────────────────────────────────────────────────────────────────────────────

export function providerGet(d: Db, id: string): Provider | undefined {
  return d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider | undefined
}

export function providerAll(d: Db, conditions?: SQL[]): Provider[] {
  const q = conditions?.length ? d.select().from(schema.provider).where(and(...conditions)) : d.select().from(schema.provider)
  return q.all() as Provider[]
}

export function providerInsert(d: Db, data: Record<string, unknown>): Provider {
  const id = nanoid()
  d.insert(schema.provider).values({ ...data, id } as any).run()
  return d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider
}

export function providerUpdate(d: Db, id: string, data: Record<string, unknown>): Provider {
  if (Object.keys(data).length > 0) d.update(schema.provider).set(data as any).where(eq(schema.provider.id, id)).run()
  return d.select().from(schema.provider).where(eq(schema.provider.id, id)).get() as Provider
}

export function providerRemove(d: Db, id: string): void {
  d.delete(schema.provider).where(eq(schema.provider.id, id)).run()
}

export function providerGetByName(d: Db, name: string): Provider | undefined {
  return d.select().from(schema.provider).where(eq(schema.provider.name, name)).get() as Provider | undefined
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export function ticketGet(d: Db, id: string): Ticket | undefined {
  return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket | undefined
}

export function ticketAll(d: Db, conditions?: SQL[]): Ticket[] {
  const q = conditions?.length ? d.select().from(schema.ticket).where(and(...conditions)) : d.select().from(schema.ticket)
  return q.all() as Ticket[]
}

export function ticketInsert(d: Db, data: Record<string, unknown>): Ticket {
  const id = nanoid()
  d.insert(schema.ticket).values({ ...data, id } as any).run()
  return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket
}

export function ticketUpdate(d: Db, id: string, data: Record<string, unknown>): Ticket {
  if (Object.keys(data).length > 0) d.update(schema.ticket).set(data as any).where(eq(schema.ticket.id, id)).run()
  return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket
}

export function ticketRemove(d: Db, id: string): void {
  d.delete(schema.ticket).where(eq(schema.ticket.id, id)).run()
}

// ────────────────────────────────────────────────────────────────────────────
// COMMENT
// ────────────────────────────────────────────────────────────────────────────

export function commentGet(d: Db, id: string): Comment | undefined {
  return d.select().from(schema.comment).where(eq(schema.comment.id, id)).get() as Comment | undefined
}

export function commentAll(d: Db, conditions?: SQL[]): Comment[] {
  const q = conditions?.length ? d.select().from(schema.comment).where(and(...conditions)) : d.select().from(schema.comment)
  return q.all() as Comment[]
}

export function commentInsert(d: Db, data: Record<string, unknown>): Comment {
  const id = nanoid()
  d.insert(schema.comment).values({ ...data, id } as any).run()
  return d.select().from(schema.comment).where(eq(schema.comment.id, id)).get() as Comment
}

export function commentByTicket(d: Db, ticketId: string): Comment[] {
  return d.select().from(schema.comment).where(eq(schema.comment.ticket_id, ticketId)).orderBy(schema.comment.created_at).all() as Comment[]
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export function agentGet(d: Db, id: string): Agent | undefined {
  return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent | undefined
}

export function agentAll(d: Db, conditions?: SQL[]): Agent[] {
  const q = conditions?.length ? d.select().from(schema.agent).where(and(...conditions)) : d.select().from(schema.agent)
  return q.all() as Agent[]
}

export function agentInsert(d: Db, data: Record<string, unknown>): Agent {
  const id = nanoid()
  d.insert(schema.agent).values({ ...data, id } as any).run()
  return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent
}

export function agentUpdate(d: Db, id: string, data: Record<string, unknown>): Agent {
  if (Object.keys(data).length > 0) d.update(schema.agent).set(data as any).where(eq(schema.agent.id, id)).run()
  return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent
}

export function agentRemove(d: Db, id: string): void {
  d.delete(schema.agent).where(eq(schema.agent.id, id)).run()
}

// ────────────────────────────────────────────────────────────────────────────
// SESSION
// ────────────────────────────────────────────────────────────────────────────

const sessionWithAgentColumns = {
  id:            schema.session.id,
  ticket_id:     schema.session.ticket_id,
  agent_id:      schema.session.agent_id,
  agent_name:    schema.agent.name,
  status:        schema.session.status,
  model:         schema.session.model,
  error:         schema.session.error,
  tokens_in:     schema.session.tokens_in,
  tokens_out:    schema.session.tokens_out,
  cost_usd:      schema.session.cost_usd,
  duration_ms:   schema.session.duration_ms,
  step_count:    schema.session.step_count,
  tool_calls:    schema.session.tool_calls,
  finish_reason: schema.session.finish_reason,
  started_at:    schema.session.started_at,
  ended_at:      schema.session.ended_at,
}

export function sessionGet(d: Db, id: string): Session | undefined {
  return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session | undefined
}

export function sessionAll(d: Db, conditions?: SQL[]): Session[] {
  const q = conditions?.length ? d.select().from(schema.session).where(and(...conditions)) : d.select().from(schema.session)
  return q.all() as Session[]
}

export function sessionInsert(d: Db, data: Record<string, unknown>): Session {
  const id = nanoid()
  d.insert(schema.session).values({ ...data, id } as any).run()
  return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session
}

export function sessionUpdate(d: Db, id: string, data: Record<string, unknown>): Session {
  if (Object.keys(data).length > 0) d.update(schema.session).set(data as any).where(eq(schema.session.id, id)).run()
  return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session
}

export function sessionRemove(d: Db, id: string): void {
  d.delete(schema.session).where(eq(schema.session.id, id)).run()
}

export function sessionByTicket(d: Db, ticketId: string) {
  return d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent, eq(schema.session.agent_id, schema.agent.id))
    .where(eq(schema.session.ticket_id, ticketId))
    .orderBy(schema.session.started_at)
    .all()
}

export function sessionListWithAgent(d: Db) {
  return d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent, eq(schema.session.agent_id, schema.agent.id))
    .orderBy(schema.session.started_at)
    .all()
    .reverse()
    .slice(0, 200)
}

// ────────────────────────────────────────────────────────────────────────────
// MESSAGE
// ────────────────────────────────────────────────────────────────────────────

export function messageGet(d: Db, id: string): Message | undefined {
  return d.select().from(schema.message).where(eq(schema.message.id, id)).get() as Message | undefined
}

export function messageAll(d: Db, conditions?: SQL[]): Message[] {
  const q = conditions?.length ? d.select().from(schema.message).where(and(...conditions)) : d.select().from(schema.message)
  return q.all() as Message[]
}

export function messageInsert(d: Db, data: Record<string, unknown>): Message {
  const id = nanoid()
  d.insert(schema.message).values({ ...data, id } as any).run()
  return d.select().from(schema.message).where(eq(schema.message.id, id)).get() as Message
}

export function messageBySession(d: Db, sessionId: string): Message[] {
  return d.select().from(schema.message).where(eq(schema.message.session_id, sessionId)).all() as Message[]
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION
// ════════════════════════════════════════════════════════════════════════════

export function executionGet(d: Db, id: string): Execution | undefined {
  return d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution | undefined
}

export function executionAll(d: Db, conditions?: SQL[]): Execution[] {
  const q = conditions?.length ? d.select().from(schema.execution).where(and(...conditions)) : d.select().from(schema.execution)
  return q.all() as Execution[]
}

export function executionInsert(d: Db, data: Record<string, unknown>): Execution {
  const id = nanoid()
  d.insert(schema.execution).values({ ...data, id } as any).run()
  return d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution
}

export function executionUpdate(d: Db, id: string, data: Record<string, unknown>): Execution {
  if (Object.keys(data).length > 0) d.update(schema.execution).set(data as any).where(eq(schema.execution.id, id)).run()
  return d.select().from(schema.execution).where(eq(schema.execution.id, id)).get() as Execution
}

export function executionRemove(d: Db, id: string): void {
  d.delete(schema.execution).where(eq(schema.execution.id, id)).run()
}

export function executionBySession(d: Db, sessionId: string): Execution[] {
  return d.select().from(schema.execution).where(eq(schema.execution.session_id, sessionId)).all() as Execution[]
}
