import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Activity, Session } from '../tables.js'
import type { Config } from '../config.js'
import { mustExist, assertStatus, now } from '../util.js'
import { ticketClaim, ticketGet } from './tickets.js'

export function sessionGet(db: Db, id: string) {
  return mustExist(database.sessionGetAggregated(db, id))
}

export function sessionStatus(db: Db, id: string): { status: string } {
  return { status: mustExist(database.sessionGet(db, id)).status }
}

export function sessionKill(db: Db, id: string): { ok: true } {
  assertStatus(mustExist(database.sessionGet(db, id)), 'running', 'session is not running')
  database.sessionUpdate(db, id, { status: 'cancelled', error: 'killed', ended_at: now() })
  return { ok: true }
}

// One activity row per discrete event. Runtime populates these at stream
// time; domain layer offers the list view plus an enforced-correctness
// insert helper.
export function sessionActivities(db: Db, sessionId: string): Activity[] {
  mustExist(database.sessionGet(db, sessionId))
  return database.activityBySession(db, sessionId)
}

export function activityCreate(db: Db, input: {
  session_id:   string
  turn_id?:     string | null
  kind:         'prompt' | 'thought' | 'said' | 'tool_call' | 'reconcile'
  order_index?: number
  payload:      unknown
  tool_use_id?: string
  execution_id?: string
  tokens_in?:   number | null
  tokens?:      number | null
}): Activity {
  mustExist(database.sessionGet(db, input.session_id))
  if (input.kind === 'tool_call' && !input.execution_id) {
    throw new Error('activity.kind=tool_call requires execution_id (sandbox-domain correlation is enforced)')
  }
  return database.activityInsert(db, {
    session_id:   input.session_id,
    turn_id:      input.turn_id ?? null,
    kind:         input.kind,
    order_index:  input.order_index ?? 0,
    payload:      JSON.stringify(input.payload),
    tool_use_id:  input.tool_use_id ?? null,
    execution_id: input.execution_id ?? null,
    tokens_in:    input.tokens_in ?? null,
    tokens:       input.tokens ?? null,
    created_at:   now(),
  })
}

export function sessionByTicket(db: Db, ticketId: string) {
  mustExist(database.ticketGet(db, ticketId))
  return database.sessionByTicket(db, ticketId)
}

export function sessionListAll(db: Db) {
  return database.sessionListWithAgent(db)
}

// Posted when a session begins so the founder has visibility into in-flight
// work rather than a silent gap until completion. Paired with the
// ticketComplete / ticketFail comments that fire at session end.
export function sessionStartedComment(db: Db, ticketId: string, agentName: string, sessionId: string): void {
  database.commentInsert(db, {
    ticket_id:  ticketId,
    session_id: sessionId,
    author:     agentName,
    body:       'Session started',
    created_at: now(),
  })
}

export async function sessionStart(db: Db, config: Config, agentDefId: string, ticketId: string): Promise<Session> {
  const agentDef = mustExist(database.agentGet(db, agentDefId), 'agent not found')
  mustExist(ticketClaim(db, ticketId), 'ticket is not claimable (already claimed, done, or failed)')
  // Backfill ticket.agent_id on the first session so the ticket reflects who's
  // working it. Don't overwrite if the founder pre-assigned it — that's a
  // routing preference the scheduler should preserve.
  const existing = ticketGet(db, ticketId)
  if (!existing.agent_id) {
    database.ticketUpdate(db, ticketId, { agent_id: agentDefId, updated_at: now() })
  }
  const t = ticketGet(db, ticketId)

  const row = database.sessionInsert(db, {
    ticket_id: ticketId, agent_id: agentDefId,
    status: 'running', started_at: now(),
  })
  sessionStartedComment(db, ticketId, agentDef.name, row.id)

  const { runAgentSession } = await import('../runtime/runner-ai.js')
  runAgentSession(db, config, row.id, agentDef, t).catch((err: unknown) =>
    console.error(`session ${row.id} crashed:`, err))

  return row
}
