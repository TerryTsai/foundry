import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from './schema.js'
import {
  project as projectT, provider as providerT,
  ticket as ticketT, comment as commentT,
  agent as agentT, session as sessionT, message as messageT, execution as executionT,
  type Agent, type Comment, type Execution, type Message, type Project, type Provider, type Session, type Ticket,
} from './schema.js'

export type Db = ReturnType<typeof drizzle<typeof schema>>

export const createDatabase = (path: string): Db => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

const project = {
  get:    (d: Db, id: string) => d.select().from(projectT).where(eq(projectT.id, id)).get() as Project | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(projectT).where(and(...conditions)).all() : d.select().from(projectT).all()) as Project[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(projectT).values({ ...data, id } as any).run(); return d.select().from(projectT).where(eq(projectT.id, id)).get() as Project },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(projectT).set(data as any).where(eq(projectT.id, id)).run(); return d.select().from(projectT).where(eq(projectT.id, id)).get() as Project },
  remove: (d: Db, id: string) => { d.delete(projectT).where(eq(projectT.id, id)).run() },
}

const provider = {
  get:       (d: Db, id: string) => d.select().from(providerT).where(eq(providerT.id, id)).get() as Provider | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(providerT).where(and(...conditions)).all() : d.select().from(providerT).all()) as Provider[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(providerT).values({ ...data, id } as any).run(); return d.select().from(providerT).where(eq(providerT.id, id)).get() as Provider },
  update:    (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(providerT).set(data as any).where(eq(providerT.id, id)).run(); return d.select().from(providerT).where(eq(providerT.id, id)).get() as Provider },
  remove:    (d: Db, id: string) => { d.delete(providerT).where(eq(providerT.id, id)).run() },
  getByName: (d: Db, name: string) => d.select().from(providerT).where(eq(providerT.name, name)).get() as Provider | undefined,
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

const ticket = {
  get:    (d: Db, id: string) => d.select().from(ticketT).where(eq(ticketT.id, id)).get() as Ticket | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(ticketT).where(and(...conditions)).all() : d.select().from(ticketT).all()) as Ticket[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(ticketT).values({ ...data, id } as any).run(); return d.select().from(ticketT).where(eq(ticketT.id, id)).get() as Ticket },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(ticketT).set(data as any).where(eq(ticketT.id, id)).run(); return d.select().from(ticketT).where(eq(ticketT.id, id)).get() as Ticket },
  remove: (d: Db, id: string) => { d.delete(ticketT).where(eq(ticketT.id, id)).run() },
}

const comment = {
  get:      (d: Db, id: string) => d.select().from(commentT).where(eq(commentT.id, id)).get() as Comment | undefined,
  all:      (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(commentT).where(and(...conditions)).all() : d.select().from(commentT).all()) as Comment[],
  insert:   (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(commentT).values({ ...data, id } as any).run(); return d.select().from(commentT).where(eq(commentT.id, id)).get() as Comment },
  byTicket: (d: Db, ticketId: string) => d.select().from(commentT).where(eq(commentT.ticket_id, ticketId)).all(),
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const agent = {
  get:    (d: Db, id: string) => d.select().from(agentT).where(eq(agentT.id, id)).get() as Agent | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(agentT).where(and(...conditions)).all() : d.select().from(agentT).all()) as Agent[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(agentT).values({ ...data, id } as any).run(); return d.select().from(agentT).where(eq(agentT.id, id)).get() as Agent },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(agentT).set(data as any).where(eq(agentT.id, id)).run(); return d.select().from(agentT).where(eq(agentT.id, id)).get() as Agent },
  remove: (d: Db, id: string) => { d.delete(agentT).where(eq(agentT.id, id)).run() },
}

const session = {
  get:    (d: Db, id: string) => d.select().from(sessionT).where(eq(sessionT.id, id)).get() as Session | undefined,
  all:    (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(sessionT).where(and(...conditions)).all() : d.select().from(sessionT).all()) as Session[],
  insert: (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(sessionT).values({ ...data, id } as any).run(); return d.select().from(sessionT).where(eq(sessionT.id, id)).get() as Session },
  update: (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(sessionT).set(data as any).where(eq(sessionT.id, id)).run(); return d.select().from(sessionT).where(eq(sessionT.id, id)).get() as Session },
  remove: (d: Db, id: string) => { d.delete(sessionT).where(eq(sessionT.id, id)).run() },
  byTicket: (d: Db, ticketId: string) =>
    d.select({
      id: sessionT.id, ticket_id: sessionT.ticket_id, agent_id: sessionT.agent_id,
      agent_name: agentT.name, status: sessionT.status, model: sessionT.model,
      error: sessionT.error, tokens_in: sessionT.tokens_in, tokens_out: sessionT.tokens_out,
      cost_usd: sessionT.cost_usd, duration_ms: sessionT.duration_ms,
      step_count: sessionT.step_count, tool_calls: sessionT.tool_calls, finish_reason: sessionT.finish_reason,
      started_at: sessionT.started_at, ended_at: sessionT.ended_at,
    }).from(sessionT).leftJoin(agentT, eq(sessionT.agent_id, agentT.id))
      .where(eq(sessionT.ticket_id, ticketId)).orderBy(sessionT.started_at).all(),
  listWithAgent: (d: Db) =>
    d.select({
      id: sessionT.id, ticket_id: sessionT.ticket_id, agent_id: sessionT.agent_id,
      agent_name: agentT.name, status: sessionT.status, model: sessionT.model,
      error: sessionT.error, tokens_in: sessionT.tokens_in, tokens_out: sessionT.tokens_out,
      cost_usd: sessionT.cost_usd, duration_ms: sessionT.duration_ms,
      step_count: sessionT.step_count, tool_calls: sessionT.tool_calls, finish_reason: sessionT.finish_reason,
      started_at: sessionT.started_at, ended_at: sessionT.ended_at,
    }).from(sessionT).leftJoin(agentT, eq(sessionT.agent_id, agentT.id))
      .orderBy(sessionT.started_at).all().reverse().slice(0, 200),
}

const message = {
  get:       (d: Db, id: string) => d.select().from(messageT).where(eq(messageT.id, id)).get() as Message | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(messageT).where(and(...conditions)).all() : d.select().from(messageT).all()) as Message[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(messageT).values({ ...data, id } as any).run(); return d.select().from(messageT).where(eq(messageT.id, id)).get() as Message },
  bySession: (d: Db, sessionId: string) => d.select().from(messageT).where(eq(messageT.session_id, sessionId)).all(),
}

const execution = {
  get:       (d: Db, id: string) => d.select().from(executionT).where(eq(executionT.id, id)).get() as Execution | undefined,
  all:       (d: Db, conditions?: SQL[]) => (conditions?.length ? d.select().from(executionT).where(and(...conditions)).all() : d.select().from(executionT).all()) as Execution[],
  insert:    (d: Db, data: Record<string, unknown>) => { const id = nanoid(); d.insert(executionT).values({ ...data, id } as any).run(); return d.select().from(executionT).where(eq(executionT.id, id)).get() as Execution },
  update:    (d: Db, id: string, data: Record<string, unknown>) => { if (Object.keys(data).length > 0) d.update(executionT).set(data as any).where(eq(executionT.id, id)).run(); return d.select().from(executionT).where(eq(executionT.id, id)).get() as Execution },
  remove:    (d: Db, id: string) => { d.delete(executionT).where(eq(executionT.id, id)).run() },
  bySession: (d: Db, sessionId: string) => d.select().from(executionT).where(eq(executionT.session_id, sessionId)).all(),
}

// ════════════════════════════════════════════════════════════════════════════

const database = { project, provider, ticket, comment, agent, session, message, execution }
export default database
