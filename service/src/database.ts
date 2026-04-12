import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, sql, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as schema from './schema.js'
import type { Account, Agent, AuthSession, Comment, Connection, Execution, Message, Project, Session, Ticket, TicketTag } from './schema.js'

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
    CREATE INDEX IF NOT EXISTS idx_ticket_tag_ticket_id  ON ticket_tag(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_tag_tag        ON ticket_tag(tag);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_tag_unique ON ticket_tag(ticket_id, tag);
  `)

  // One-shot backfill: pre-existing assistant messages stored their tool calls
  // as a JSON array in `content` but didn't track tool_call_count. Derive it
  // from json_array_length so historical data still rolls up correctly. Idempotent.
  sqlite.exec(`
    UPDATE message
    SET tool_call_count = json_array_length(content)
    WHERE role = 'assistant' AND tool_call_count IS NULL AND content LIKE '[%'
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
  const id = ulid()
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

// Backfill: claim every project with empty owner_id for the account whose
// github login matches OWNER_GITHUB_LOGIN. Idempotent — once owner_id is set
// the row is skipped. Called from server boot after createDatabase.
export function claimUnownedProjects(d: Db, ownerLogin: string): number {
  const owner = d.select().from(schema.account).where(eq(schema.account.login, ownerLogin)).get() as Account | undefined
  if (!owner) return 0
  const result = d.update(schema.project).set({ owner_id: owner.id }).where(eq(schema.project.owner_id, '')).run()
  return result.changes
}

// ────────────────────────────────────────────────────────────────────────────
// ACCOUNT
// ────────────────────────────────────────────────────────────────────────────

export function accountGet(d: Db, id: string): Account | undefined {
  return d.select().from(schema.account).where(eq(schema.account.id, id)).get() as Account | undefined
}

export function accountGetByGithubId(d: Db, githubId: number): Account | undefined {
  return d.select().from(schema.account).where(eq(schema.account.github_id, githubId)).get() as Account | undefined
}

export function accountUpsertByGithubId(d: Db, data: {
  github_id:  number
  login:      string
  name:       string | null
  email:      string | null
  avatar_url: string | null
}): Account {
  const now = new Date().toISOString()
  const existing = accountGetByGithubId(d, data.github_id)
  if (existing) {
    d.update(schema.account)
      .set({ login: data.login, name: data.name, email: data.email, avatar_url: data.avatar_url, updated_at: now })
      .where(eq(schema.account.id, existing.id))
      .run()
    return accountGet(d, existing.id)!
  }
  const id = ulid()
  d.insert(schema.account).values({ ...data, id, created_at: now, updated_at: now }).run()
  return accountGet(d, id)!
}

// ────────────────────────────────────────────────────────────────────────────
// AUTH SESSION
// ────────────────────────────────────────────────────────────────────────────

export function authSessionGet(d: Db, id: string): AuthSession | undefined {
  return d.select().from(schema.authSession).where(eq(schema.authSession.id, id)).get() as AuthSession | undefined
}

export function authSessionInsert(d: Db, data: { id: string; account_id: string; created_at: string; expires_at: string }): AuthSession {
  d.insert(schema.authSession).values(data).run()
  return authSessionGet(d, data.id)!
}

export function authSessionRemove(d: Db, id: string): void {
  d.delete(schema.authSession).where(eq(schema.authSession.id, id)).run()
}

// ────────────────────────────────────────────────────────────────────────────
// CONNECTION (generalized provider — LLMs, integrations, anything with creds)
// ────────────────────────────────────────────────────────────────────────────

export function connectionGet(d: Db, id: string): Connection | undefined {
  return d.select().from(schema.connection).where(eq(schema.connection.id, id)).get() as Connection | undefined
}

export function connectionAll(d: Db, conditions?: SQL[]): Connection[] {
  const q = conditions?.length ? d.select().from(schema.connection).where(and(...conditions)) : d.select().from(schema.connection)
  return q.all() as Connection[]
}

export function connectionInsert(d: Db, data: Record<string, unknown>): Connection {
  const id = ulid()
  d.insert(schema.connection).values({ ...data, id } as any).run()
  return d.select().from(schema.connection).where(eq(schema.connection.id, id)).get() as Connection
}

export function connectionUpdate(d: Db, id: string, data: Record<string, unknown>): Connection {
  if (Object.keys(data).length > 0) d.update(schema.connection).set(data as any).where(eq(schema.connection.id, id)).run()
  return d.select().from(schema.connection).where(eq(schema.connection.id, id)).get() as Connection
}

export function connectionRemove(d: Db, id: string): void {
  d.delete(schema.connection).where(eq(schema.connection.id, id)).run()
}

export function connectionGetByName(d: Db, name: string): Connection | undefined {
  return d.select().from(schema.connection).where(eq(schema.connection.name, name)).get() as Connection | undefined
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
  const id = ulid()
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
// TICKET TAG
// ────────────────────────────────────────────────────────────────────────────

export function ticketTagList(d: Db, ticketId: string): TicketTag[] {
  return d.select().from(schema.ticketTag).where(eq(schema.ticketTag.ticket_id, ticketId)).all() as TicketTag[]
}

export function ticketTagInsert(d: Db, ticketId: string, tag: string): TicketTag {
  const id = ulid()
  const normalizedTag = tag.toLowerCase().trim()
  const created_at = new Date().toISOString()
  d.insert(schema.ticketTag).values({ id, ticket_id: ticketId, tag: normalizedTag, created_at }).run()
  return d.select().from(schema.ticketTag).where(eq(schema.ticketTag.id, id)).get() as TicketTag
}

export function ticketTagRemove(d: Db, ticketId: string, tag: string): void {
  d.delete(schema.ticketTag).where(and(eq(schema.ticketTag.ticket_id, ticketId), eq(schema.ticketTag.tag, tag))).run()
}

export function ticketsByTag(d: Db, tag: string, conditions?: SQL[]): Ticket[] {
  const where = [eq(schema.ticketTag.tag, tag), ...(conditions ?? [])]
  return d.select({
    id:         schema.ticket.id,
    project_id: schema.ticket.project_id,
    agent_id:   schema.ticket.agent_id,
    title:      schema.ticket.title,
    body:       schema.ticket.body,
    status:     schema.ticket.status,
    priority:   schema.ticket.priority,
    parent_id:  schema.ticket.parent_id,
    created_by: schema.ticket.created_by,
    created_at: schema.ticket.created_at,
    updated_at: schema.ticket.updated_at,
    claimed_at: schema.ticket.claimed_at,
  }).from(schema.ticketTag)
    .innerJoin(schema.ticket, eq(schema.ticketTag.ticket_id, schema.ticket.id))
    .where(and(...where))
    .all() as Ticket[]
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
  const id = ulid()
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
  const id = ulid()
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

// All session selects that need rolled-up usage go through this column map.
// tokens_in / tokens_out / step_count are aggregated from message rows (the
// LEFT JOIN below). tool_calls is sourced from the execution table via
// subquery — every tool invocation goes through executionCreate, which is
// the same code path for the managed loop and the SDK runner. That makes
// the count backend-agnostic and independent of how the loop chose to
// persist messages.
const sessionWithAgentColumns = {
  id:            schema.session.id,
  ticket_id:     schema.session.ticket_id,
  agent_id:      schema.session.agent_id,
  agent_name:    schema.agent.name,
  status:        schema.session.status,
  model:         schema.session.model,
  error:         schema.session.error,
  cost_usd:      schema.session.cost_usd,
  duration_ms:   schema.session.duration_ms,
  finish_reason: schema.session.finish_reason,
  started_at:    schema.session.started_at,
  ended_at:      schema.session.ended_at,
  tokens_in:  sql<number | null>`SUM(${schema.message.tokens_in})`.as('tokens_in'),
  tokens_out: sql<number | null>`SUM(${schema.message.tokens})`.as('tokens_out'),
  step_count: sql<number | null>`NULLIF(COUNT(CASE WHEN ${schema.message.role} = 'assistant' THEN 1 END), 0)`.as('step_count'),
  tool_calls: sql<number | null>`NULLIF((SELECT COUNT(*) FROM execution WHERE execution.session_id = session.id), 0)`.as('tool_calls'),
}

export function sessionGet(d: Db, id: string): Session | undefined {
  return d.select().from(schema.session).where(eq(schema.session.id, id)).get() as Session | undefined
}

export function sessionAll(d: Db, conditions?: SQL[]): Session[] {
  const q = conditions?.length ? d.select().from(schema.session).where(and(...conditions)) : d.select().from(schema.session)
  return q.all() as Session[]
}

export function sessionInsert(d: Db, data: Record<string, unknown>): Session {
  const id = ulid()
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

export function sessionGetAggregated(d: Db, id: string) {
  return d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent,   eq(schema.session.agent_id, schema.agent.id))
    .leftJoin(schema.message, eq(schema.message.session_id, schema.session.id))
    .where(eq(schema.session.id, id))
    .groupBy(schema.session.id)
    .get()
}

export function sessionAggregateAll(d: Db, conditions?: SQL[]) {
  const base = d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent,   eq(schema.session.agent_id, schema.agent.id))
    .leftJoin(schema.message, eq(schema.message.session_id, schema.session.id))
  const filtered = conditions?.length ? base.where(and(...conditions)) : base
  return filtered.groupBy(schema.session.id).orderBy(schema.session.started_at).all()
}

export function sessionByTicket(d: Db, ticketId: string) {
  return sessionAggregateAll(d, [eq(schema.session.ticket_id, ticketId)])
}

export function sessionListWithAgent(d: Db) {
  return sessionAggregateAll(d).reverse().slice(0, 200)
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
  const id = ulid()
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
  const id = ulid()
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
