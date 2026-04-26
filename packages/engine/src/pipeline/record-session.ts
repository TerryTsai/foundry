// Session bookkeeping: row updates + event emission. Updates the
// session row's terminal state and emits an event.

import { now } from '@foundry/model'
import type { Middleware, SessionContext } from './compose.js'

export const recordSession: Middleware = (next) => async (ctx) => {
  emitStartEvent(ctx)
  try {
    await next(ctx)
    finalizeSession(ctx)
    return ctx
  } catch (errVal) {
    finalizeFailedSession(ctx, errVal)
    throw errVal
  } finally {
    await ctx.deps.sandbox.stopSessionContainer(ctx.session.id).catch(() => {})
  }
}

function emitStartEvent(ctx: SessionContext): void {
  ctx.deps.crud.eventCreate(ctx.db, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_started',
    data: JSON.stringify({ agent: ctx.agent.name, ticket_id: ctx.ticket.id }),
    caused_by: 'runtime',
  })
}

function finalizeSession(ctx: SessionContext): void {
  const r = ctx.result!
  const status = r.cancelled ? 'cancelled' : 'finished'
  ctx.deps.crud.sessionUpdateById(ctx.db, ctx.session.id, {
    status, cost_usd: r.costUsd,
    duration_ms: Date.now() - ctx.startedAt, ended_at: now(),
  })
  ctx.deps.crud.eventCreate(ctx.db, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_' + status,
    data: JSON.stringify({ duration_ms: Date.now() - ctx.startedAt, cost_usd: r.costUsd }),
    caused_by: 'runtime',
  })
}

function finalizeFailedSession(ctx: SessionContext, errVal: unknown): void {
  const msg = errVal instanceof Error ? errVal.message : String(errVal)
  ctx.deps.crud.sessionUpdateById(ctx.db, ctx.session.id, {
    status: 'failed', error: msg,
    duration_ms: Date.now() - ctx.startedAt, ended_at: now(),
  })
  ctx.deps.crud.eventCreate(ctx.db, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_failed',
    data: JSON.stringify({ error: msg }),
    caused_by: 'runtime',
  })
}
