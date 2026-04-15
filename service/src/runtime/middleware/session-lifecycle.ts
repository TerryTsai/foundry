// Record the session's terminal state. On clean completion, write
// finished/cancelled status + metrics. On throw, write status=failed and
// re-raise so outer middleware (ticket-fail guard, orchestrator) can
// react. Outermost wrapper — owns the session row's final write.

import * as database from '../../database.js'
import { now } from '../../util.js'
import type { Middleware } from '../compose.js'

export const withSessionLifecycle: Middleware = (next) => async (ctx) => {
  try {
    await next(ctx)
    const r = ctx.result!
    database.sessionUpdate(ctx.db, ctx.session.id, {
      status:        r.cancelled ? 'cancelled' : 'finished',
      finish_reason: r.cancelled ? 'cancelled' : r.finishReason,
      cost_usd:      r.costUsd,
      duration_ms:   Date.now() - ctx.startedAt,
      ended_at:      now(),
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
    throw err
  }
}
