// Producer-only: if the agent loop throws, resolve the ticket as
// 'failed' so it doesn't sit in `claimed` forever. Verifier sessions
// must NOT use this — their crash goes through synthetic-fail-verdict
// instead, and the orchestrator continues the dance.

import { ticketResolve } from '../../domain/tickets.js'
import type { Middleware } from '../compose.js'

export const withTicketFailOnCrash: Middleware = (next) => async (ctx) => {
  try { return await next(ctx) }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try {
      ticketResolve(ctx.db, ctx.ticket.id, 'failed', {
        notes: msg, agentName: ctx.agent.name, sessionId: ctx.session.id,
      })
    } catch { /* don't mask the original */ }
    throw err
  }
}
