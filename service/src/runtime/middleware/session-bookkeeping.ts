// Session bookkeeping: row updates + ticket comments + event emission.
// Posts "Session started" before the loop, then on completion writes the
// session row's terminal state and a human-readable comment.

import * as database from '../../database.js'
import { now } from '../../util.js'
import type { Middleware, SessionContext } from '../compose.js'

function comment(ctx: SessionContext, body: string) {
  database.commentInsert(ctx.db, {
    ticket_id:  ctx.ticket.id,
    session_id: ctx.session.id,
    author:     ctx.agent.name,
    body,
    created_at: now(),
  })
}

export const withSessionBookkeeping: Middleware = (next) => async (ctx) => {
  comment(ctx, 'Session started')
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
      kind: 'status_changed',
      data: JSON.stringify({ from: 'running', to: status }),
      caused_by: 'runtime',
    })
    comment(ctx, r.cancelled ? 'Session cancelled' : 'Session finished')
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
      kind: 'status_changed',
      data: JSON.stringify({ from: 'running', to: 'failed', error: msg }),
      caused_by: 'runtime',
    })
    comment(ctx, 'Session crashed')
    throw err
  }
}
