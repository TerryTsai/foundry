import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from './schema.js'
import {
  tickets, projects, agentDefinitions, agentSessions, agentMessages, sandboxRuns,
  type Ticket, type Project, type AgentDefinition, type AgentSession, type AgentMessage, type SandboxRun,
} from './schema.js'

// ── Types ──

type Drizzle = ReturnType<typeof drizzle<typeof schema>>

interface TableOps<Row, Insert> {
  get:    (id: string) => Row | undefined
  all:    (conditions?: SQL[]) => Row[]
  insert: (data: Omit<Insert, 'id'>) => Row
  update: (id: string, data: Partial<Insert>) => Row
  remove: (id: string) => void
}

export interface SessionRow {
  id: string; ticket_id: string; agent_def_id: string
  agent_name: string | null; status: string
  started_at: string; ended_at: string | null
}

// ── Table factory ──

const makeTable = <Row, Insert extends { id: string }>(
  d: Drizzle,
  table: Parameters<Drizzle['select']>[0] extends undefined ? any : any,
  idCol: any,
): TableOps<Row, Insert> => ({
  get: (id) =>
    d.select().from(table).where(eq(idCol, id)).get() as Row | undefined,

  all: (conditions) =>
    conditions?.length
      ? d.select().from(table).where(and(...conditions)).all() as Row[]
      : d.select().from(table).all() as Row[],

  insert: (data) => {
    const id = nanoid()
    d.insert(table).values({ ...data, id } as any).run()
    return d.select().from(table).where(eq(idCol, id)).get() as Row
  },

  update: (id, data) => {
    if (Object.keys(data).length > 0) {
      d.update(table).set(data as any).where(eq(idCol, id)).run()
    }
    return d.select().from(table).where(eq(idCol, id)).get() as Row
  },

  remove: (id) => {
    d.delete(table).where(eq(idCol, id)).run()
  },
})

// ── Db interface ──

export interface Db {
  tickets:    TableOps<Ticket, schema.NewTicket & { id: string }>
  projects:   TableOps<Project, schema.NewProject & { id: string }>
  agents:     TableOps<AgentDefinition, schema.NewAgentDefinition & { id: string }>
  sessions:   TableOps<AgentSession, { id: string; ticket_id: string; agent_def_id: string; status: string; started_at: string; ended_at?: string | null }>
    & { listWithAgent: () => SessionRow[] }
  messages:   TableOps<AgentMessage, { id: string; session_id: string; role: string; content: string; created_at: string }>
    & { bySession: (sessionId: string) => AgentMessage[] }
  runs:       TableOps<SandboxRun, { id: string; session_id?: string | null; image: string; command: string; status: string; started_at: string; exit_code?: number | null; ended_at?: string | null }>
  tx: <T>(fn: (db: Db) => T) => T
  eq:      typeof eq
  and:     typeof and
  isNull:  typeof isNull
  col: {
    ticket:  typeof tickets
    project: typeof projects
    agent:   typeof agentDefinitions
    session: typeof agentSessions
    message: typeof agentMessages
    run:     typeof sandboxRuns
  }
}

const wrapDrizzle = (d: Drizzle): Db => {
  const sessions = {
    ...makeTable<AgentSession, any>(d, agentSessions, agentSessions.id),
    listWithAgent: (): SessionRow[] =>
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
  }

  const messages = {
    ...makeTable<AgentMessage, any>(d, agentMessages, agentMessages.id),
    bySession: (sessionId: string): AgentMessage[] =>
      d.select().from(agentMessages).where(eq(agentMessages.session_id, sessionId)).all(),
  }

  const db: Db = {
    tickets:  makeTable<Ticket, any>(d, tickets, tickets.id),
    projects: makeTable<Project, any>(d, projects, projects.id),
    agents:   makeTable<AgentDefinition, any>(d, agentDefinitions, agentDefinitions.id),
    sessions,
    messages,
    runs:     makeTable<SandboxRun, any>(d, sandboxRuns, sandboxRuns.id),
    tx: <T>(fn: (db: Db) => T): T => d.transaction(tx => fn(wrapDrizzle(tx as any))) as T,
    eq, and, isNull,
    col: {
      ticket:  tickets,
      project: projects,
      agent:   agentDefinitions,
      session: agentSessions,
      message: agentMessages,
      run:     sandboxRuns,
    },
  }
  return db
}

// ── Constructor ──

export const createDb = (path: string): Db => {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return wrapDrizzle(drizzle(sqlite, { schema }))
}
