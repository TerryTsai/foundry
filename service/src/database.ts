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

// ── Query helpers ──

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

// ── Session join fields (shared between byTicket and listWithAgent) ──

const sessionJoinFields = {
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
} as const

// ── CRUD table factory ──

const crud = <T>(d: Drizzle, table: any, idCol: any) => ({
  get:    (id: string) => getById<T>(d, table, idCol, id),
  all:    (conditions?: SQL[]) => getAll<T>(d, table, conditions),
  insert: (data: Record<string, unknown>) => insertRow<T>(d, table, idCol, data),
  update: (id: string, data: Record<string, unknown>) => updateRow<T>(d, table, idCol, id, data),
  remove: (id: string) => removeRow(d, table, idCol, id),
})

// ── Constructor ──

const build = (d: Drizzle) => ({
  // ── Project ──
  project:   crud<Project>(d, project, project.id),
  provider:  { ...crud<Provider>(d, provider, provider.id),
    getByName: (name: string) => d.select().from(provider).where(eq(provider.name, name)).get() as Provider | undefined,
  },

  // ── Ticketing ──
  ticket:  crud<Ticket>(d, ticket, ticket.id),
  comment: {
    get:      (id: string) => getById<Comment>(d, comment, comment.id, id),
    all:      (conditions?: SQL[]) => getAll<Comment>(d, comment, conditions),
    insert:   (data: Record<string, unknown>) => insertRow<Comment>(d, comment, comment.id, data),
    byTicket: (ticketId: string) =>
      d.select().from(comment).where(eq(comment.ticket_id, ticketId)).all(),
  },

  // ── Agent ──
  agent:   crud<Agent>(d, agent, agent.id),
  session: { ...crud<Session>(d, session, session.id),
    byTicket: (ticketId: string) =>
      d.select(sessionJoinFields).from(session)
        .leftJoin(agent, eq(session.agent_id, agent.id))
        .where(eq(session.ticket_id, ticketId))
        .orderBy(session.started_at).all(),
    listWithAgent: () =>
      d.select(sessionJoinFields).from(session)
        .leftJoin(agent, eq(session.agent_id, agent.id))
        .orderBy(session.started_at).all()
        .reverse().slice(0, 200),
  },
  message: {
    get:       (id: string) => getById<Message>(d, message, message.id, id),
    all:       (conditions?: SQL[]) => getAll<Message>(d, message, conditions),
    insert:    (data: Record<string, unknown>) => insertRow<Message>(d, message, message.id, data),
    bySession: (sessionId: string) =>
      d.select().from(message).where(eq(message.session_id, sessionId)).all(),
  },
  execution: { ...crud<Execution>(d, execution, execution.id),
    bySession: (sessionId: string) =>
      d.select().from(execution).where(eq(execution.session_id, sessionId)).all(),
  },

  // ── Shared ──
  tx: <T>(fn: (db: Db) => T): T => d.transaction(tx => fn(build(tx as any))) as T,
  eq, and, isNull,
  col: { ticket, comment, project, provider, agent, session, message, execution },
})

export type Db = ReturnType<typeof build>

export const createDatabase = (path: string): Db => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return build(drizzle(sqlite, { schema }))
}
