import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Activity, Session } from '../tables.js'
import { mustExist, assertStatus, now } from '../util.js'

export function sessionGet(db: Db, id: string) {
  return mustExist(database.sessionGetAggregated(db, id))
}

export function sessionStatus(db: Db, id: string): { status: string } {
  return { status: mustExist(database.sessionGet(db, id)).status }
}

export function sessionKill(db: Db, id: string): { ok: true } {
  assertStatus(mustExist(database.sessionGet(db, id)), 'running', 'session is not running')
  database.sessionUpdate(db, id, { status: 'cancelled', error: 'killed', ended_at: now() })
  database.eventInsert(db, {
    entity_type: 'session', entity_id: id,
    kind: 'status_changed',
    data: JSON.stringify({ from: 'running', to: 'cancelled', reason: 'killed' }),
    caused_by: 'founder',
  })
  return { ok: true }
}

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
