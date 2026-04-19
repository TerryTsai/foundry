import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, sql, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as schema from './schema.js'
import type { Account, Activity, Agent, AuthSession, Comment, Connection, Event, Execution, Project, Session, Ticket } from './schema.js'

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

  // Indexes — idempotent, safe on every startup. Big one-shot migrations
  // live outside this file (see scripts/migrate-activity.js).
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_session_id    ON activity(session_id);
    CREATE INDEX IF NOT EXISTS idx_activity_turn_id       ON activity(turn_id);
    CREATE INDEX IF NOT EXISTS idx_activity_execution_id  ON activity(execution_id);
    CREATE INDEX IF NOT EXISTS idx_activity_tool_use_id   ON activity(tool_use_id);
    CREATE INDEX IF NOT EXISTS idx_activity_kind          ON activity(kind);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_turn_order
      ON activity(session_id, turn_id, order_index) WHERE turn_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_execution_session_id   ON execution(session_id);

    CREATE INDEX IF NOT EXISTS idx_comment_ticket_id      ON comment(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_ticket_id      ON session(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_session_agent_id       ON session(agent_id);
    CREATE INDEX IF NOT EXISTS idx_session_started_at     ON session(started_at);

    CREATE INDEX IF NOT EXISTS idx_ticket_project_id      ON ticket(project_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_status          ON ticket(status);
    CREATE INDEX IF NOT EXISTS idx_ticket_project_status  ON ticket(project_id, status);

    CREATE INDEX IF NOT EXISTS idx_agent_account_id       ON agent(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_current_name
      ON agent(account_id, name) WHERE superseded_at IS NULL;

    CREATE TABLE IF NOT EXISTS event (
      id           TEXT PRIMARY KEY,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      kind         TEXT NOT NULL,
      data         TEXT NOT NULL DEFAULT '{}',
      caused_by    TEXT NOT NULL,
      caused_by_id TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_entity    ON event(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_event_entity_id ON event(entity_id);

    -- sandbox_token table dropped — per-session auth is now a stateless
    -- HMAC JWT (see auth/session-jwt.ts).
    DROP TABLE IF EXISTS sandbox_token;
  `)

  // ── one-shot schema simplifications (idempotent) ───────────────────
  // Each block guards on whether the migration has already happened
  // (column / table presence), so re-running is a no-op.

  // 1) Add ticket.tags JSON column, backfill from the legacy tag table,
  //    drop the table.
  if (!hasColumn(sqlite, 'ticket', 'tags')) {
    sqlite.exec(`ALTER TABLE ticket ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`)
  }
  if (hasTable(sqlite, 'tag')) {
    sqlite.exec(`
      UPDATE ticket SET tags = COALESCE(
        (SELECT json_group_array(tag) FROM tag WHERE tag.ticket_id = ticket.id),
        '[]'
      );
      DROP TABLE tag;
    `)
  }

  // 2) Migrate verdict rows into activity (kind='verdict') and drop
  //    the table. Verdict.id is a ULID; reusing it as activity.id
  //    can't collide with any existing activity row.
  if (hasTable(sqlite, 'verdict')) {
    sqlite.exec(`
      INSERT INTO activity (id, session_id, turn_id, kind, order_index,
                            payload, tool_use_id, execution_id,
                            tokens_in, tokens, created_at)
      SELECT id, session_id, NULL, 'verdict', 0,
             json_object('pass', json(CASE WHEN pass = 1 THEN 'true' ELSE 'false' END),
                         'reason', reason),
             NULL, NULL, NULL, NULL, created_at
      FROM verdict;
      DROP TABLE verdict;
    `)
  }

  // 3) Drop session.system_prompt — was duplicated by the prompt
  //    activity row, never read after write.
  if (hasColumn(sqlite, 'session', 'system_prompt')) {
    sqlite.exec(`ALTER TABLE session DROP COLUMN system_prompt`)
  }

  // 4) Drop execution.tool_use_id — duplicated by activity.tool_use_id.
  //    SQLite refuses to drop a column referenced by an index, so the
  //    legacy idx_execution_tool_use_id has to go first.
  if (hasColumn(sqlite, 'execution', 'tool_use_id')) {
    sqlite.exec(`
      DROP INDEX IF EXISTS idx_execution_tool_use_id;
      ALTER TABLE execution DROP COLUMN tool_use_id;
    `)
  }

  return drizzle(sqlite, { schema })
}

// ── helpers for the idempotent migrations ────────────────────────────

function hasTable(db: Database.Database, name: string): boolean {
  const r = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  return r != null
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
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

export function projectsActive(d: Db): Project[] {
  return d.select().from(schema.project).where(eq(schema.project.status, 'active')).all() as Project[]
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

export function connectionByAccount(d: Db, accountId: string): Connection[] {
  return d.select().from(schema.connection).where(eq(schema.connection.account_id, accountId)).all() as Connection[]
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

// Atomic status transition — only succeeds if ticket is in the expected state.
// Returns true on success, false if another reconciler tick beat us.
export function ticketTransition(d: Db, id: string, from: string, to: string): boolean {
  const now = new Date().toISOString()
  const r = d.update(schema.ticket)
    .set({ status: to, updated_at: now })
    .where(and(eq(schema.ticket.id, id), eq(schema.ticket.status, from)))
    .run()
  return r.changes > 0
}

export function ticketRemove(d: Db, id: string): void {
  d.delete(schema.ticket).where(eq(schema.ticket.id, id)).run()
}

// ────────────────────────────────────────────────────────────────────────────
// TICKET TAG
// ────────────────────────────────────────────────────────────────────────────

// Tag helpers — tags now live as a JSON array on ticket.tags. The
// service layer uses parseTags / setTags below; ticketsByTag does
// substring matching on the JSON column (good enough at this scale;
// SQLite's json_each could replace this if it ever becomes hot).

export function parseTags(ticket: Ticket): string[] {
  try {
    const v = JSON.parse(ticket.tags)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export function setTags(d: Db, ticketId: string, tags: string[]): void {
  const dedup = Array.from(new Set(tags.map(t => t.toLowerCase().trim()).filter(Boolean)))
  d.update(schema.ticket).set({ tags: JSON.stringify(dedup), updated_at: new Date().toISOString() })
   .where(eq(schema.ticket.id, ticketId)).run()
}

export function projectTagList(d: Db, projectId: string): string[] {
  const tickets = d.select({ tags: schema.ticket.tags }).from(schema.ticket)
    .where(eq(schema.ticket.project_id, projectId)).all() as Array<{ tags: string }>
  const set = new Set<string>()
  for (const t of tickets) {
    try {
      const arr = JSON.parse(t.tags)
      if (Array.isArray(arr)) for (const x of arr) if (typeof x === 'string') set.add(x)
    } catch { /* skip */ }
  }
  return [...set].sort()
}

export function ticketsByTag(d: Db, tag: string, conditions?: SQL[]): Ticket[] {
  // SQLite LIKE on a JSON array — matches the quoted token. Combined with
  // the caller's project / status filters via AND.
  const needle = `%${JSON.stringify(tag.toLowerCase().trim())}%`
  const where = [sql`${schema.ticket.tags} LIKE ${needle}`, ...(conditions ?? [])]
  return d.select().from(schema.ticket).where(and(...where)).all() as Ticket[]
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
// tokens_in / tokens_out / step_count are aggregated from activity rows
// (LEFT JOIN below). Only the first activity of each turn carries tokens,
// so SUM over activities == modelUsage exactly. tool_calls is sourced from
// the execution table via subquery — every tool invocation goes through
// executionCreate.
const sessionWithAgentColumns = {
  id:            schema.session.id,
  ticket_id:     schema.session.ticket_id,
  agent_id:      schema.session.agent_id,
  agent_name:    schema.agent.name,
  model:         schema.agent.model,       // agent is immutable, so reading from agent is stable
  status:        schema.session.status,
  error:         schema.session.error,
  cost_usd:      schema.session.cost_usd,
  duration_ms:   schema.session.duration_ms,
  started_at:    schema.session.started_at,
  ended_at:      schema.session.ended_at,
  tokens_in:  sql<number | null>`SUM(${schema.activity.tokens_in})`.as('tokens_in'),
  tokens_out: sql<number | null>`SUM(${schema.activity.tokens})`.as('tokens_out'),
  step_count: sql<number | null>`NULLIF(COUNT(DISTINCT ${schema.activity.turn_id}), 0)`.as('step_count'),
  tool_calls: sql<number | null>`NULLIF((SELECT COUNT(*) FROM execution WHERE execution.session_id = session.id), 0)`.as('tool_calls'),
}

export function sessionRunningForTicket(d: Db, ticketId: string): Session[] {
  return d.select().from(schema.session).where(and(
    eq(schema.session.ticket_id, ticketId),
    eq(schema.session.status, 'running'),
  )).all() as Session[]
}

export function sessionRunning(d: Db): Session[] {
  return d.select().from(schema.session).where(eq(schema.session.status, 'running')).all() as Session[]
}

export function sessionsByTicketRaw(d: Db, ticketId: string): Session[] {
  return d.select().from(schema.session).where(eq(schema.session.ticket_id, ticketId)).orderBy(schema.session.started_at).all() as Session[]
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
    .leftJoin(schema.activity, eq(schema.activity.session_id, schema.session.id))
    .where(eq(schema.session.id, id))
    .groupBy(schema.session.id)
    .get()
}

export function sessionAggregateAll(d: Db, conditions?: SQL[]) {
  const base = d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent,   eq(schema.session.agent_id, schema.agent.id))
    .leftJoin(schema.activity, eq(schema.activity.session_id, schema.session.id))
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
// ACTIVITY
// ────────────────────────────────────────────────────────────────────────────

export function activityGet(d: Db, id: string): Activity | undefined {
  return d.select().from(schema.activity).where(eq(schema.activity.id, id)).get() as Activity | undefined
}

export function activityAll(d: Db, conditions?: SQL[]): Activity[] {
  const q = conditions?.length ? d.select().from(schema.activity).where(and(...conditions)) : d.select().from(schema.activity)
  return q.all() as Activity[]
}

export function activityInsert(d: Db, data: Record<string, unknown>): Activity {
  const id = ulid()
  d.insert(schema.activity).values({ ...data, id } as any).run()
  return d.select().from(schema.activity).where(eq(schema.activity.id, id)).get() as Activity
}

export function activityUpdate(d: Db, id: string, data: Record<string, unknown>): Activity {
  if (Object.keys(data).length > 0) d.update(schema.activity).set(data as any).where(eq(schema.activity.id, id)).run()
  return d.select().from(schema.activity).where(eq(schema.activity.id, id)).get() as Activity
}

export function activityBySession(d: Db, sessionId: string): Activity[] {
  return d.select().from(schema.activity)
    .where(eq(schema.activity.session_id, sessionId))
    .orderBy(schema.activity.created_at, schema.activity.order_index)
    .all() as Activity[]
}

// Find an existing activity for a given turn + order_index. Used by the
// runtime to upsert streaming-emission blocks in place.
export function activityByTurnOrder(d: Db, sessionId: string, turnId: string, orderIndex: number): Activity | undefined {
  return d.select().from(schema.activity)
    .where(and(
      eq(schema.activity.session_id, sessionId),
      eq(schema.activity.turn_id, turnId),
      eq(schema.activity.order_index, orderIndex),
    ))
    .get() as Activity | undefined
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

// ════════════════════════════════════════════════════════════════════════════
// VERDICT (lives in activity now — kind='verdict' with payload {pass, reason})
// ════════════════════════════════════════════════════════════════════════════

export interface VerdictRow {
  id:         string
  session_id: string
  agent_id:   string       // resolved from session.agent_id
  ticket_id:  string       // resolved from session.ticket_id
  pass:       boolean
  reason:     string
  created_at: string
}

function activityToVerdict(d: Db, a: Activity): VerdictRow | null {
  let body: { pass?: unknown; reason?: unknown }
  try { body = JSON.parse(a.payload) } catch { return null }
  if (typeof body.pass !== 'boolean') return null
  const sess = d.select({ ticket_id: schema.session.ticket_id, agent_id: schema.session.agent_id })
    .from(schema.session).where(eq(schema.session.id, a.session_id)).get() as { ticket_id: string; agent_id: string } | undefined
  if (!sess) return null
  return {
    id: a.id, session_id: a.session_id,
    agent_id: sess.agent_id, ticket_id: sess.ticket_id,
    pass: body.pass,
    reason: typeof body.reason === 'string' ? body.reason : '',
    created_at: a.created_at,
  }
}

export function verdictByTicket(d: Db, ticketId: string): VerdictRow[] {
  // activity → session → ticket
  const rows = d.select({ a: schema.activity }).from(schema.activity)
    .innerJoin(schema.session, eq(schema.activity.session_id, schema.session.id))
    .where(and(eq(schema.activity.kind, 'verdict'), eq(schema.session.ticket_id, ticketId)))
    .orderBy(schema.activity.created_at)
    .all() as Array<{ a: Activity }>
  return rows.map(r => activityToVerdict(d, r.a)).filter((v): v is VerdictRow => v != null)
}

export function verdictBySession(d: Db, sessionId: string): VerdictRow | undefined {
  const a = d.select().from(schema.activity)
    .where(and(eq(schema.activity.session_id, sessionId), eq(schema.activity.kind, 'verdict')))
    .orderBy(schema.activity.created_at)
    .get() as Activity | undefined
  if (!a) return undefined
  return activityToVerdict(d, a) ?? undefined
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT
// ════════════════════════════════════════════════════════════════════════════

export function eventInsert(d: Db, data: {
  entity_type: string; entity_id: string; kind: string
  data?: string; caused_by: string; caused_by_id?: string | null
}): Event {
  const id = ulid()
  const created_at = new Date().toISOString()
  d.insert(schema.event).values({
    id, entity_type: data.entity_type, entity_id: data.entity_id,
    kind: data.kind, data: data.data ?? '{}',
    caused_by: data.caused_by, caused_by_id: data.caused_by_id ?? null,
    created_at,
  }).run()
  return d.select().from(schema.event).where(eq(schema.event.id, id)).get() as Event
}

export function eventByEntity(d: Db, entityType: string, entityId: string): Event[] {
  return d.select().from(schema.event)
    .where(and(eq(schema.event.entity_type, entityType), eq(schema.event.entity_id, entityId)))
    .orderBy(schema.event.created_at)
    .all() as Event[]
}

export function eventLatest(d: Db, entityType: string, entityId: string): Event | undefined {
  return d.select().from(schema.event)
    .where(and(eq(schema.event.entity_type, entityType), eq(schema.event.entity_id, entityId)))
    .orderBy(sql`created_at DESC`)
    .limit(1)
    .get() as Event | undefined
}
