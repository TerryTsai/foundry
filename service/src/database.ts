import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from './schema.js'
import {
  agent, comment, execution, message, project, provider, session, ticket,
  type Agent, type Comment, type Execution, type Message, type Project, type Provider, type Session, type Ticket,
} from './schema.js'

type Drizzle = ReturnType<typeof drizzle<typeof schema>>

// ── Reusable query helpers ──

const getById = <T>(d: Drizzle, table: any, idCol: any, id: string): T | undefined =>
  d.select().from(table).where(eq(idCol, id)).get() as T | undefined

const getAll = <T>(d: Drizzle, table: any, conditions?: SQL[]): T[] =>
  (conditions?.length
    ? d.select().from(table).where(and(...conditions)).all()
    : d.select().from(table).all()) as T[]

const insertRow = <T>(d: Drizzle, table: any, idCol: any, data: Record<string, unknown>): T => {
  const id = nanoid()
  d.insert(table).values({ ...data, id } as any).run()
  return d.select().from(table).where(eq(idCol, id)).get() as T
}

const updateRow = <T>(d: Drizzle, table: any, idCol: any, id: string, data: Record<string, unknown>): T => {
  if (Object.keys(data).length > 0) {
    d.update(table).set(data as any).where(eq(idCol, id)).run()
  }
  return d.select().from(table).where(eq(idCol, id)).get() as T
}

const removeRow = (d: Drizzle, table: any, idCol: any, id: string): void => {
  d.delete(table).where(eq(idCol, id)).run()
}

// ── Database interface ──

export interface SessionRow {
  id: string; ticket_id: string; agent_id: string
  agent_name: string | null; status: string; model: string
  error: string | null; tokens_in: number | null; tokens_out: number | null
  cost_usd: number | null; duration_ms: number | null
  step_count: number | null; tool_calls: number | null; finish_reason: string | null
  started_at: string; ended_at: string | null
}

export interface Db {
  // ── Project ──
  project: {
    get:    (id: string) => Project | undefined
    all:    (conditions?: SQL[]) => Project[]
    insert: (data: Record<string, unknown>) => Project
    update: (id: string, data: Record<string, unknown>) => Project
    remove: (id: string) => void
  }
  provider: {
    get:       (id: string) => Provider | undefined
    all:       (conditions?: SQL[]) => Provider[]
    insert:    (data: Record<string, unknown>) => Provider
    update:    (id: string, data: Record<string, unknown>) => Provider
    remove:    (id: string) => void
    getByName: (name: string) => Provider | undefined
  }
  // ── Ticketing ──
  ticket: {
    get:    (id: string) => Ticket | undefined
    all:    (conditions?: SQL[]) => Ticket[]
    insert: (data: Record<string, unknown>) => Ticket
    update: (id: string, data: Record<string, unknown>) => Ticket
    remove: (id: string) => void
  }
  comment: {
    get:      (id: string) => Comment | undefined
    all:      (conditions?: SQL[]) => Comment[]
    insert:   (data: Record<string, unknown>) => Comment
    byTicket: (ticketId: string) => Comment[]
  }
  // ── Agent ──
  agent: {
    get:    (id: string) => Agent | undefined
    all:    (conditions?: SQL[]) => Agent[]
    insert: (data: Record<string, unknown>) => Agent
    update: (id: string, data: Record<string, unknown>) => Agent
    remove: (id: string) => void
  }
  session: {
    get:           (id: string) => Session | undefined
    all:           (conditions?: SQL[]) => Session[]
    insert:        (data: Record<string, unknown>) => Session
    update:        (id: string, data: Record<string, unknown>) => Session
    remove:        (id: string) => void
    byTicket:      (ticketId: string) => SessionRow[]
    listWithAgent: () => SessionRow[]
  }
  message: {
    get:       (id: string) => Message | undefined
    all:       (conditions?: SQL[]) => Message[]
    insert:    (data: Record<string, unknown>) => Message
    bySession: (sessionId: string) => Message[]
  }
  execution: {
    get:       (id: string) => Execution | undefined
    all:       (conditions?: SQL[]) => Execution[]
    insert:    (data: Record<string, unknown>) => Execution
    update:    (id: string, data: Record<string, unknown>) => Execution
    remove:    (id: string) => void
    bySession: (sessionId: string) => Execution[]
  }
  // ── Shared ──
  tx: <T>(fn: (db: Db) => T) => T
  eq:     typeof eq
  and:    typeof and
  isNull: typeof isNull
  col: {
    ticket:    typeof ticket
    comment:   typeof comment
    project:   typeof project
    provider:  typeof provider
    agent:     typeof agent
    session:   typeof session
    message:   typeof message
    execution: typeof execution
  }
}

// ── Constructor ──

const wrap = (d: Drizzle): Db => ({
  // ── Project ──
  project: {
    get:    (id) => getById<Project>(d, project, project.id, id),
    all:    (c)  => getAll<Project>(d, project, c),
    insert: (data) => insertRow<Project>(d, project, project.id, data),
    update: (id, data) => updateRow<Project>(d, project, project.id, id, data),
    remove: (id) => removeRow(d, project, project.id, id),
  },
  provider: {
    get:       (id) => getById<Provider>(d, provider, provider.id, id),
    all:       (c)  => getAll<Provider>(d, provider, c),
    insert:    (data) => insertRow<Provider>(d, provider, provider.id, data),
    update:    (id, data) => updateRow<Provider>(d, provider, provider.id, id, data),
    remove:    (id) => removeRow(d, provider, provider.id, id),
    getByName: (name) => d.select().from(provider).where(eq(provider.name, name)).get() as Provider | undefined,
  },
  // ── Ticketing ──
  ticket: {
    get:    (id) => getById<Ticket>(d, ticket, ticket.id, id),
    all:    (c)  => getAll<Ticket>(d, ticket, c),
    insert: (data) => insertRow<Ticket>(d, ticket, ticket.id, data),
    update: (id, data) => updateRow<Ticket>(d, ticket, ticket.id, id, data),
    remove: (id) => removeRow(d, ticket, ticket.id, id),
  },
  comment: {
    get:      (id) => getById<Comment>(d, comment, comment.id, id),
    all:      (c)  => getAll<Comment>(d, comment, c),
    insert:   (data) => insertRow<Comment>(d, comment, comment.id, data),
    byTicket: (ticketId) =>
      d.select().from(comment).where(eq(comment.ticket_id, ticketId)).all(),
  },
  // ── Agent ──
  agent: {
    get:    (id) => getById<Agent>(d, agent, agent.id, id),
    all:    (c)  => getAll<Agent>(d, agent, c),
    insert: (data) => insertRow<Agent>(d, agent, agent.id, data),
    update: (id, data) => updateRow<Agent>(d, agent, agent.id, id, data),
    remove: (id) => removeRow(d, agent, agent.id, id),
  },
  session: {
    get:    (id) => getById<Session>(d, session, session.id, id),
    all:    (c)  => getAll<Session>(d, session, c),
    insert: (data) => insertRow<Session>(d, session, session.id, data),
    update: (id, data) => updateRow<Session>(d, session, session.id, id, data),
    remove: (id) => removeRow(d, session, session.id, id),
    byTicket: (ticketId: string) =>
      d.select({
        id:            session.id,
        ticket_id:     session.ticket_id,
        agent_id:      session.agent_id,
        agent_name:    agent.name,
        status:        session.status,
        model:         session.model,
        error:         session.error,
        tokens_in:     session.tokens_in,
        tokens_out:    session.tokens_out,
        cost_usd:      session.cost_usd,
        duration_ms:   session.duration_ms,
        step_count:    session.step_count,
        tool_calls:    session.tool_calls,
        finish_reason: session.finish_reason,
        started_at:    session.started_at,
        ended_at:      session.ended_at,
      })
      .from(session)
      .leftJoin(agent, eq(session.agent_id, agent.id))
      .where(eq(session.ticket_id, ticketId))
      .orderBy(session.started_at)
      .all() as SessionRow[],
    listWithAgent: () =>
      d.select({
        id:            session.id,
        ticket_id:     session.ticket_id,
        agent_id:      session.agent_id,
        agent_name:    agent.name,
        status:        session.status,
        model:         session.model,
        error:         session.error,
        tokens_in:     session.tokens_in,
        tokens_out:    session.tokens_out,
        cost_usd:      session.cost_usd,
        duration_ms:   session.duration_ms,
        step_count:    session.step_count,
        tool_calls:    session.tool_calls,
        finish_reason: session.finish_reason,
        started_at:    session.started_at,
        ended_at:      session.ended_at,
      })
      .from(session)
      .leftJoin(agent, eq(session.agent_id, agent.id))
      .orderBy(session.started_at)
      .all()
      .reverse()
      .slice(0, 200),
  },
  message: {
    get:       (id) => getById<Message>(d, message, message.id, id),
    all:       (c)  => getAll<Message>(d, message, c),
    insert:    (data) => insertRow<Message>(d, message, message.id, data),
    bySession: (sessionId) =>
      d.select().from(message).where(eq(message.session_id, sessionId)).all(),
  },
  execution: {
    get:    (id) => getById<Execution>(d, execution, execution.id, id),
    all:    (c)  => getAll<Execution>(d, execution, c),
    insert: (data) => insertRow<Execution>(d, execution, execution.id, data),
    update: (id, data) => updateRow<Execution>(d, execution, execution.id, id, data),
    remove: (id) => removeRow(d, execution, execution.id, id),
    bySession: (sessionId) =>
      d.select().from(execution).where(eq(execution.session_id, sessionId)).all(),
  },
  tx: <T>(fn: (db: Db) => T): T => d.transaction(tx => fn(wrap(tx as any))) as T,
  eq, and, isNull,
  col: {
    ticket, comment, project, provider, agent, session, message, execution,
  },
})

export const createDatabase = (path: string): Db => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return wrap(drizzle(sqlite, { schema }))
}
