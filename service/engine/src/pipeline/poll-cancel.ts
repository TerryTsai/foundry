// Install a shouldStop() poller on the context. The loop calls it at
// step/message boundaries; resolving true breaks out cleanly.
//
// Stops when the ticket leaves `running` (founder cancel, reconciler
// state change) or the session leaves `running` (external kill).

import type { SessionStep } from '../schema.js'

export function pollCancel(next: SessionStep): SessionStep {
  return async (ctx) => {
    const { deps, session, ticket } = ctx
    ctx.shouldStop = async () => {
      const tR = await deps.crud.ticketGetById(ctx.ctx, ticket.id)
      if (!tR.ok || !tR.value || tR.value.status !== 'running') return true
      const sR = await deps.crud.sessionGetById(ctx.ctx, session.id)
      if (!sR.ok || !sR.value || sR.value.status !== 'running') return true
      return false
    }
    return next(ctx)
  }
}
