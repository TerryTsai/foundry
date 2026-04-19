import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import * as schema from '../core/schema.js'
import type { Activity, Session } from '../core/schema.js'
import { mustExist, assertStatus, now } from '../core/util.js'
import { notFound } from '../core/errors.js'
import { sessionOwned, ticketOwned } from '../projects/service.js'
import { eq, inArray } from 'drizzle-orm'

export function sessionGet(db: Db, accountId: string, id: string) {
  sessionOwned(db, id, accountId)
  return mustExist(database.sessionGetAggregated(db, id))
}

export function sessionStatus(db: Db, accountId: string, id: string): { status: string } {
  const s = sessionOwned(db, id, accountId)
  return { status: s.status }
}

export function verdictSet(
  db: Db, accountId: string, id: string, input: { pass: boolean; reason: string },
): { ok: true; recorded: { pass: boolean } } {
  sessionOwned(db, id, accountId)
  database.sessionUpdate(db, id, {
    verdict_pass:   input.pass,
    verdict_reason: input.reason,
  })
  return { ok: true, recorded: { pass: input.pass } }
}

export function sessionKill(db: Db, accountId: string, id: string): { ok: true } {
  const s = sessionOwned(db, id, accountId)
  assertStatus(s, 'running', 'session is not running')
  database.sessionUpdate(db, id, { status: 'cancelled', error: 'killed', ended_at: now() })
  database.eventInsert(db, {
    entity_type: 'session', entity_id: id,
    kind: 'status_changed',
    data: JSON.stringify({ from: 'running', to: 'cancelled', reason: 'killed' }),
    caused_by: 'founder',
  })
  return { ok: true }
}

export function sessionActivities(db: Db, accountId: string, sessionId: string): Activity[] {
  sessionOwned(db, sessionId, accountId)
  return database.activityBySession(db, sessionId)
}

// Internal — runtime emits activity rows for sessions it just dispatched.
// No HTTP boundary, no ownership check; trust the caller.
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

export function sessionByTicket(db: Db, accountId: string, ticketId: string) {
  ticketOwned(db, ticketId, accountId)
  return database.sessionByTicket(db, ticketId)
}

export function sessionListAll(db: Db, accountId: string) {
  // Restrict to sessions whose ticket belongs to a project the requester
  // owns. Pre-compute the set of allowed project ids.
  const owned = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  if (owned.length === 0) return []
  return database.sessionListWithAgent(db).filter(s => {
    const t = database.ticketGet(db, s.ticket_id)
    return t ? owned.includes(t.project_id) : false
  })
}
