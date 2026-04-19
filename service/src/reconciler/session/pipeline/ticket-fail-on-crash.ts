// Producer-only: if the agent loop throws, mark the ticket as failed
// so it doesn't sit in `running` forever. The reconciler will see the
// terminal state and move on.

import * as database from '../../../core/db.js'
import { now } from '../../../core/util.js'
import type { Middleware } from './compose.js'

export const withTicketFailOnCrash: Middleware = (next) => async (ctx) => {
  try { return await next(ctx) }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      database.ticketUpdate(ctx.db, ctx.ticket.id, { status: 'failed', updated_at: now() })
      database.eventInsert(ctx.db, {
        entity_type: 'ticket', entity_id: ctx.ticket.id,
        kind: 'status_changed',
        data: JSON.stringify({ from: 'running', to: 'failed', reason: msg }),
        caused_by: 'runtime', caused_by_id: ctx.session.id,
      })
    } catch { /* don't mask the original */ }
    throw err
  }
}
