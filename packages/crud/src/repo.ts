// Repo helpers — per-entity SQL/drizzle queries and writes. Originally
// lived in @foundry/db/src/db.ts; consolidated here so that only crud
// (and analytics, by exception) imports drizzle directly. Other logic
// modules reach the persistence layer through callbacks the composition
// root injects.
//
// Naming reflects the original db.ts: nouns + verbs (projectGet,
// ticketInsert, eventInsert, …). Each function takes (db, …) and is
// pure: no ownership or domain checks here, just the persistence step.

import { eq, and, sql, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type {
  Account, Activity, Agent, AuthSession, Comment, Connection, Event,
  Execution, Project, Session, Ticket,
} from '@foundry/db'

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

// ════════════════════════════════════════════════════════════════════════════
// ACCOUNT
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// AUTH SESSION
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// CONNECTION
// ════════════════════════════════════════════════════════════════════════════

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
// TICKET
// ════════════════════════════════════════════════════════════════════════════

export function ticketGet(d: Db, id: string): Ticket | undefined {
  return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket | undefined
}

export function ticketAll(d: Db, conditions?: SQL[]): Ticket[] {
  const q = conditions?.length ? d.select().from(schema.ticket).where(and(...conditions)) : d.select().from(schema.ticket)
  return q.all() as Ticket[]
}

// Tickets in a project with a specific status. Composed (project_id, status)
// filter without exposing drizzle conditions to callers.
export function ticketAllByProjectStatus(d: Db, projectId: string, status: string): Ticket[] {
  return d.select().from(schema.ticket).where(and(
    eq(schema.ticket.project_id, projectId),
    eq(schema.ticket.status, status),
  )).all() as Ticket[]
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

// ── tags (live as JSON array on ticket.tags) ─────────────────────────

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

// eslint-disable-next-line max-depth -- legacy; refactor in Phase 7
export function projectTagList(d: Db, projectId: string): string[] {
  const tickets = d.select({ tags: schema.ticket.tags }).from(schema.ticket)
    .where(eq(schema.ticket.project_id, projectId)).all() as Array<{ tags: string }>
  const set = new Set<string>()
  for (const t of tickets) {
    try {
      const arr = JSON.parse(t.tags)
      // eslint-disable-next-line max-depth -- legacy; refactor in Phase 7
      if (Array.isArray(arr)) for (const x of arr) if (typeof x === 'string') set.add(x)
    } catch { /* skip */ }
  }
  return [...set].sort()
}

export function ticketsByTag(d: Db, tag: string, conditions?: SQL[]): Ticket[] {
  const needle = `%${JSON.stringify(tag.toLowerCase().trim())}%`
  const where = [sql`${schema.ticket.tags} LIKE ${needle}`, ...(conditions ?? [])]
  return d.select().from(schema.ticket).where(and(...where)).all() as Ticket[]
}

// ════════════════════════════════════════════════════════════════════════════
// COMMENT
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// SESSION (rolled-up usage columns + raw access)
// ════════════════════════════════════════════════════════════════════════════

const sessionWithAgentColumns = {
  id:             schema.session.id,
  ticket_id:      schema.session.ticket_id,
  agent_id:       schema.session.agent_id,
  agent_name:     schema.agent.name,
  model:          schema.agent.model,
  status:         schema.session.status,
  error:          schema.session.error,
  cost_usd:       schema.session.cost_usd,
  duration_ms:    schema.session.duration_ms,
  verdict_pass:   schema.session.verdict_pass,
  verdict_reason: schema.session.verdict_reason,
  started_at:     schema.session.started_at,
  ended_at:       schema.session.ended_at,
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
    .leftJoin(schema.agent,    eq(schema.session.agent_id, schema.agent.id))
    .leftJoin(schema.activity, eq(schema.activity.session_id, schema.session.id))
    .where(eq(schema.session.id, id))
    .groupBy(schema.session.id)
    .get()
}

export function sessionAggregateAll(d: Db, conditions?: SQL[]) {
  const base = d.select(sessionWithAgentColumns)
    .from(schema.session)
    .leftJoin(schema.agent,    eq(schema.session.agent_id, schema.agent.id))
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

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY
// ════════════════════════════════════════════════════════════════════════════

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
// VERDICT (lives on session.verdict_pass / session.verdict_reason)
// ════════════════════════════════════════════════════════════════════════════

export interface VerdictRow {
  id:         string       // session.id (1:1)
  session_id: string
  agent_id:   string
  ticket_id:  string
  pass:       boolean
  reason:     string
  created_at: string       // session.ended_at ?? session.started_at
}

function sessionToVerdict(s: Session): VerdictRow | null {
  if (s.verdict_pass === null || s.verdict_pass === undefined) return null
  return {
    id:         s.id,
    session_id: s.id,
    agent_id:   s.agent_id,
    ticket_id:  s.ticket_id,
    pass:       Boolean(s.verdict_pass),
    reason:     s.verdict_reason ?? '',
    created_at: s.ended_at ?? s.started_at,
  }
}

export function verdictByTicket(d: Db, ticketId: string): VerdictRow[] {
  const sessions = d.select().from(schema.session)
    .where(eq(schema.session.ticket_id, ticketId))
    .orderBy(schema.session.started_at)
    .all() as Session[]
  return sessions.map(sessionToVerdict).filter((v): v is VerdictRow => v != null)
}

export function verdictBySession(d: Db, sessionId: string): VerdictRow | undefined {
  const s = sessionGet(d, sessionId)
  if (!s) return undefined
  return sessionToVerdict(s) ?? undefined
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
