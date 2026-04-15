// Install a shouldStop() poller on the context. The loop calls it at
// step/message boundaries; returning true breaks out cleanly.
//
// Stops when the ticket leaves `claimed` (founder cancel, verifier-dance
// reopen) or the session leaves `running` (external kill). The ticket
// stays `claimed` through the whole verifier dance, so a founder cancel
// mid-verifier cascades to both producer and verifier sessions.

import * as database from '../../database.js'
import type { Middleware } from '../compose.js'

export const withCooperativeCancel: Middleware = (next) => async (ctx) => {
  const { db, session, ticket } = ctx
  ctx.shouldStop = () => {
    const t = database.ticketGet(db, ticket.id)
    if (!t || t.status !== 'claimed') return true
    const s = database.sessionGet(db, session.id)
    if (!s || s.status !== 'running') return true
    return false
  }
  return next(ctx)
}
