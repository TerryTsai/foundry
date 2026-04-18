// Session bookkeeping: row updates + event emission. Updates the session
// row's terminal state and emits an event. No comments — lifecycle
// messages live in the event table, not the comment stream.

import * as database from '../../database.js'
import { now } from '../../util.js'
import type { Middleware } from '../compose.js'

export const withSessionBookkeeping: Middleware = (next) => async (ctx) => {
  database.eventInsert(ctx.db, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_started',
    data: JSON.stringify({ agent: ctx.agent.name, ticket_id: ctx.ticket.id }),
    caused_by: 'runtime',
  })
  try {
    await next(ctx)
    const r = ctx.result!
    const status = r.cancelled ? 'cancelled' : 'finished'
    database.sessionUpdate(ctx.db, ctx.session.id, {
      status,
      cost_usd:    r.costUsd,
      duration_ms: Date.now() - ctx.startedAt,
      ended_at:    now(),
    })
    database.eventInsert(ctx.db, {
      entity_type: 'session', entity_id: ctx.session.id,
      kind: 'session_' + status,
      data: JSON.stringify({ duration_ms: Date.now() - ctx.startedAt, cost_usd: r.costUsd }),
      caused_by: 'runtime',
    })
    return ctx
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    database.sessionUpdate(ctx.db, ctx.session.id, {
      status:      'failed',
      error:       msg,
      duration_ms: Date.now() - ctx.startedAt,
      ended_at:    now(),
    })
    database.eventInsert(ctx.db, {
      entity_type: 'session', entity_id: ctx.session.id,
      kind: 'session_failed',
      data: JSON.stringify({ error: msg }),
      caused_by: 'runtime',
    })
    throw err
  }
}
