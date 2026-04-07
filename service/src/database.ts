import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from './schema.js'
import {
  tickets, projects, agentDefinitions, agentSessions, agentMessages, sandboxRuns,
  type Ticket, type Project, type AgentDefinition, type AgentSession, type AgentMessage, type SandboxRun,
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
  id: string; ticket_id: string; agent_def_id: string
  agent_name: string | null; status: string
  started_at: string; ended_at: string | null
}

export interface Database {
  ticket: {
    get:    (id: string) => Ticket | undefined
    all:    (conditions?: SQL[]) => Ticket[]
    insert: (data: Record<string, unknown>) => Ticket
    update: (id: string, data: Record<string, unknown>) => Ticket
    remove: (id: string) => void
  }
  project: {
    get:    (id: string) => Project | undefined
    all:    (conditions?: SQL[]) => Project[]
    insert: (data: Record<string, unknown>) => Project
    update: (id: string, data: Record<string, unknown>) => Project
    remove: (id: string) => void
  }
  agent: {
    get:    (id: string) => AgentDefinition | undefined
    all:    (conditions?: SQL[]) => AgentDefinition[]
    insert: (data: Record<string, unknown>) => AgentDefinition
    update: (id: string, data: Record<string, unknown>) => AgentDefinition
    remove: (id: string) => void
  }
  session: {
    get:          (id: string) => AgentSession | undefined
    all:          (conditions?: SQL[]) => AgentSession[]
    insert:       (data: Record<string, unknown>) => AgentSession
    update:       (id: string, data: Record<string, unknown>) => AgentSession
    remove:       (id: string) => void
    listWithAgent: () => SessionRow[]
  }
  message: {
    get:       (id: string) => AgentMessage | undefined
    all:       (conditions?: SQL[]) => AgentMessage[]
    insert:    (data: Record<string, unknown>) => AgentMessage
    update:    (id: string, data: Record<string, unknown>) => AgentMessage
    remove:    (id: string) => void
    bySession: (sessionId: string) => AgentMessage[]
  }
  run: {
    get:    (id: string) => SandboxRun | undefined
    all:    (conditions?: SQL[]) => SandboxRun[]
    insert: (data: Record<string, unknown>) => SandboxRun
    update: (id: string, data: Record<string, unknown>) => SandboxRun
    remove: (id: string) => void
  }
  tx: <T>(fn: (db: Database) => T) => T
  eq:     typeof eq
  and:    typeof and
  isNull: typeof isNull
  col: {
    ticket:  typeof tickets
    project: typeof projects
    agent:   typeof agentDefinitions
    session: typeof agentSessions
    message: typeof agentMessages
    run:     typeof sandboxRuns
  }
}

// ── Constructor ──

const wrap = (d: Drizzle): Database => ({
  ticket: {
    get:    (id) => getById<Ticket>(d, tickets, tickets.id, id),
    all:    (c)  => getAll<Ticket>(d, tickets, c),
    insert: (data) => insertRow<Ticket>(d, tickets, tickets.id, data),
    update: (id, data) => updateRow<Ticket>(d, tickets, tickets.id, id, data),
    remove: (id) => removeRow(d, tickets, tickets.id, id),
  },
  project: {
    get:    (id) => getById<Project>(d, projects, projects.id, id),
    all:    (c)  => getAll<Project>(d, projects, c),
    insert: (data) => insertRow<Project>(d, projects, projects.id, data),
    update: (id, data) => updateRow<Project>(d, projects, projects.id, id, data),
    remove: (id) => removeRow(d, projects, projects.id, id),
  },
  agent: {
    get:    (id) => getById<AgentDefinition>(d, agentDefinitions, agentDefinitions.id, id),
    all:    (c)  => getAll<AgentDefinition>(d, agentDefinitions, c),
    insert: (data) => insertRow<AgentDefinition>(d, agentDefinitions, agentDefinitions.id, data),
    update: (id, data) => updateRow<AgentDefinition>(d, agentDefinitions, agentDefinitions.id, id, data),
    remove: (id) => removeRow(d, agentDefinitions, agentDefinitions.id, id),
  },
  session: {
    get:    (id) => getById<AgentSession>(d, agentSessions, agentSessions.id, id),
    all:    (c)  => getAll<AgentSession>(d, agentSessions, c),
    insert: (data) => insertRow<AgentSession>(d, agentSessions, agentSessions.id, data),
    update: (id, data) => updateRow<AgentSession>(d, agentSessions, agentSessions.id, id, data),
    remove: (id) => removeRow(d, agentSessions, agentSessions.id, id),
    listWithAgent: () =>
      d.select({
        id:           agentSessions.id,
        ticket_id:    agentSessions.ticket_id,
        agent_def_id: agentSessions.agent_def_id,
        agent_name:   agentDefinitions.name,
        status:       agentSessions.status,
        started_at:   agentSessions.started_at,
        ended_at:     agentSessions.ended_at,
      })
      .from(agentSessions)
      .leftJoin(agentDefinitions, eq(agentSessions.agent_def_id, agentDefinitions.id))
      .orderBy(agentSessions.started_at)
      .all()
      .reverse()
      .slice(0, 200),
  },
  message: {
    get:    (id) => getById<AgentMessage>(d, agentMessages, agentMessages.id, id),
    all:    (c)  => getAll<AgentMessage>(d, agentMessages, c),
    insert: (data) => insertRow<AgentMessage>(d, agentMessages, agentMessages.id, data),
    update: (id, data) => updateRow<AgentMessage>(d, agentMessages, agentMessages.id, id, data),
    remove: (id) => removeRow(d, agentMessages, agentMessages.id, id),
    bySession: (sessionId) =>
      d.select().from(agentMessages).where(eq(agentMessages.session_id, sessionId)).all(),
  },
  run: {
    get:    (id) => getById<SandboxRun>(d, sandboxRuns, sandboxRuns.id, id),
    all:    (c)  => getAll<SandboxRun>(d, sandboxRuns, c),
    insert: (data) => insertRow<SandboxRun>(d, sandboxRuns, sandboxRuns.id, data),
    update: (id, data) => updateRow<SandboxRun>(d, sandboxRuns, sandboxRuns.id, id, data),
    remove: (id) => removeRow(d, sandboxRuns, sandboxRuns.id, id),
  },
  tx: <T>(fn: (db: Database) => T): T => d.transaction(tx => fn(wrap(tx as any))) as T,
  eq, and, isNull,
  col: {
    ticket:  tickets,
    project: projects,
    agent:   agentDefinitions,
    session: agentSessions,
    message: agentMessages,
    run:     sandboxRuns,
  },
})

export const createDatabase = (path: string): Database => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return wrap(drizzle(sqlite, { schema }))
}
