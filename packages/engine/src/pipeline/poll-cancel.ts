// Install a shouldStop() poller on the context. The loop calls it at
// step/message boundaries; returning true breaks out cleanly.
//
// Stops when the ticket leaves `running` (founder cancel, reconciler
// state change) or the session leaves `running` (external kill).

import type { Middleware } from './compose.js'

export const pollCancel: Middleware = (next) => async (ctx) => {
  const { db, deps, session, ticket } = ctx
  ctx.shouldStop = () => {
    const t = deps.crud.ticketGetById(db, ticket.id)
    if (!t || t.status !== 'running') return true
    const s = deps.crud.sessionGetById(db, session.id)
    if (!s || s.status !== 'running') return true
    return false
  }
  return next(ctx)
}
