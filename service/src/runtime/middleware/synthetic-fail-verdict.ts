// Verifier-only: after the session ends, ensure a verdict row exists for
// this (ticket, session). A silent verifier (ended without calling
// verdictReport) or a crashed one gets a fail-closed synthetic verdict
// so the next producer's prompt surfaces the reason. Silent = failed
// review, never implicit approval.

import * as database from '../../database.js'
import { now } from '../../util.js'
import type { Middleware } from '../compose.js'

export const withSyntheticFailVerdict: Middleware = (next) => async (ctx) => {
  try { await next(ctx) }
  finally {
    // Skip synthesis on cancel: the Claude Agent SDK keeps draining
    // in-flight MCP tool calls after we break out of the loop, so a real
    // verdictReport can still land seconds later. Writing a synthetic
    // fail here would shadow it. A cancelled verifier is inconclusive,
    // not failed — the orchestrator halts the dance instead.
    if (!ctx.result?.cancelled && !database.verdictBySession(ctx.db, ctx.session.id)) {
      const reason = ctx.result
        ? 'verifier ended without reporting a verdict'
        : 'verifier crashed before reporting a verdict'
      database.verdictInsert(ctx.db, {
        ticket_id:  ctx.ticket.id,
        session_id: ctx.session.id,
        agent_id:   ctx.agent.id,
        pass:       false,
        reason,
        created_at: now(),
      })
    }
  }
  return ctx
}
