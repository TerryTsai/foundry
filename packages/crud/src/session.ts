import { eq } from 'drizzle-orm'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Activity } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { ok, err, now } from '@foundry/model'
import { sessionOwned, ticketOwned } from './project.js'
import * as database from './repo.js'

export function sessionGet(db: Db, accountId: string, id: string): Result<unknown, CrudError> {
  const owned = sessionOwned(db, id, accountId)
  if (!owned.ok) return owned
  const agg = database.sessionGetAggregated(db, id)
  if (!agg) return err({ kind: 'not_found', entity: 'session', id })
  return ok(agg)
}

export function sessionStatus(db: Db, accountId: string, id: string): Result<{ status: string }, CrudError> {
  const s = sessionOwned(db, id, accountId)
  if (!s.ok) return s
  return ok({ status: s.value.status })
}

export function verdictSet(
  db: Db, accountId: string, id: string, input: { pass: boolean; reason: string },
): Result<{ ok: true; recorded: { pass: boolean } }, CrudError> {
  const owned = sessionOwned(db, id, accountId)
  if (!owned.ok) return owned
  database.sessionUpdate(db, id, {
    verdict_pass: input.pass, verdict_reason: input.reason,
  })
  return ok({ ok: true, recorded: { pass: input.pass } })
}

export function sessionKill(db: Db, accountId: string, id: string): Result<{ ok: true }, CrudError> {
  const s = sessionOwned(db, id, accountId)
  if (!s.ok) return s
  if (s.value.status !== 'running') return err({ kind: 'conflict', reason: 'session is not running' })
  sessionKillWrite(db, id)
  return ok({ ok: true })
}

function sessionKillWrite(db: Db, id: string): void {
  database.sessionUpdate(db, id, { status: 'cancelled', error: 'killed', ended_at: now() })
  database.eventInsert(db, {
    entity_type: 'session', entity_id: id,
    kind: 'status_changed',
    data: JSON.stringify({ from: 'running', to: 'cancelled', reason: 'killed' }),
    caused_by: 'founder',
  })
}

export function sessionActivities(db: Db, accountId: string, sessionId: string): Result<Activity[], CrudError> {
  const owned = sessionOwned(db, sessionId, accountId)
  if (!owned.ok) return owned
  return ok(database.activityBySession(db, sessionId))
}

export interface ActivityCreateInput {
  session_id:   string
  turn_id?:     string | null
  kind:         'prompt' | 'thought' | 'said' | 'tool_call' | 'reconcile'
  order_index?: number
  payload:      unknown
  tool_use_id?: string
  execution_id?: string
  tokens_in?:   number | null
  tokens?:      number | null
}

// Internal — runtime emits activity rows for sessions it just dispatched.
// No HTTP boundary, no ownership check; trust the caller.
export function activityCreate(db: Db, input: ActivityCreateInput): Activity {
  if (!database.sessionGet(db, input.session_id)) {
    throw new Error(`session ${input.session_id} not found`)
  }
  if (input.kind === 'tool_call' && !input.execution_id) {
    throw new Error('activity.kind=tool_call requires execution_id (sandbox-domain correlation is enforced)')
  }
  return database.activityInsert(db, activityCreatePayload(input))
}

function activityCreatePayload(input: ActivityCreateInput): Record<string, unknown> {
  return {
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
  }
}

export function sessionByTicket(db: Db, accountId: string, ticketId: string): Result<unknown[], CrudError> {
  const owned = ticketOwned(db, ticketId, accountId)
  if (!owned.ok) return owned
  return ok(database.sessionByTicket(db, ticketId))
}

export function sessionListAll(db: Db, accountId: string): Result<unknown[], CrudError> {
  const owned = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  if (owned.length === 0) return ok([])
  const filtered = database.sessionListWithAgent(db).filter(s => {
    const t = database.ticketGet(db, s.ticket_id)
    return t ? owned.includes(t.project_id) : false
  })
  return ok(filtered)
}
