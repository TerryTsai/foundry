// Read helpers exposed for the analytics module's hand-written
// aggregates. These are deliberate, bounded re-exports — analytics is
// the one logic module besides crud allowed to import @foundry/db
// (ARCHITECTURE.md flags this as a documented exception). Keep this
// surface read-only; writes go through crud.

import { eq, and, sql, type SQL } from 'drizzle-orm'

import * as schema from './schema.js'
import type { Agent, Execution, Project, Session, Ticket } from './schema.js'
import type { Db } from './db.js'

export function projectAll(d: Db, conditions?: SQL[]): Project[] {
  const q = conditions?.length ? d.select().from(schema.project).where(and(...conditions)) : d.select().from(schema.project)
  return q.all() as Project[]
}

export function ticketGet(d: Db, id: string): Ticket | undefined {
  return d.select().from(schema.ticket).where(eq(schema.ticket.id, id)).get() as Ticket | undefined
}

export function agentGet(d: Db, id: string): Agent | undefined {
  return d.select().from(schema.agent).where(eq(schema.agent.id, id)).get() as Agent | undefined
}

export function executionBySession(d: Db, sessionId: string): Execution[] {
  return d.select().from(schema.execution).where(eq(schema.execution.session_id, sessionId)).all() as Execution[]
}

// Mirror the rolled-up session column map crud uses internally — kept
// here verbatim so analytics doesn't need to reach across modules.
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

// Re-export the Session type so analytics can name the row shape
// without re-deriving it.
export type { Session, Project, Ticket, Agent, Execution }
