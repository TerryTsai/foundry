// Producer-only: if the agent loop throws, mark the ticket as failed
// so it doesn't sit in `running` forever. The reconciler will see the
// terminal state and move on.

import { now } from '@foundry/model'
import type { SessionStep } from '../schema.js'

export function failTicketOnCrash(next: SessionStep): SessionStep {
  return async (ctx) => {
    try { return await next(ctx) }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await ctx.deps.crud.ticketUpdateById(ctx.ctx, ctx.ticket.id, { status: 'failed', updated_at: now() })
        await ctx.deps.crud.eventCreate(ctx.ctx, {
          entity_type: 'ticket', entity_id: ctx.ticket.id,
          kind: 'status_changed',
          data: JSON.stringify({ from: 'running', to: 'failed', reason: msg }),
          caused_by: 'runtime', caused_by_id: ctx.session.id,
        })
      } catch { /* don't mask the original */ }
      throw err
    }
  }
}
