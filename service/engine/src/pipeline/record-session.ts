// Session bookkeeping: row updates + event emission. Updates the
// session row's terminal state and emits an event.

import { now } from '@foundry/model'
import type { SessionStep, SessionContext } from '../schema.js'

export function recordSession(next: SessionStep): SessionStep {
  return async (ctx) => {
    await emitStartEvent(ctx)
    try {
      await next(ctx)
      await finalizeSession(ctx)
      return ctx
    } catch (errVal) {
      await finalizeFailedSession(ctx, errVal)
      throw errVal
    } finally {
      await ctx.stopSessionContainer(ctx.session.id).catch(() => {})
    }
  }
}

async function emitStartEvent(ctx: SessionContext): Promise<void> {
  await ctx.crud.eventCreate(ctx.ctx, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_started',
    data: JSON.stringify({ agent: ctx.agent.name, ticket_id: ctx.ticket.id }),
    caused_by: 'runtime',
  })
}

async function finalizeSession(ctx: SessionContext): Promise<void> {
  const r = ctx.result!
  const status = r.cancelled ? 'cancelled' : 'finished'
  await ctx.crud.sessionUpdateById(ctx.ctx, ctx.session.id, {
    status, cost_usd: r.costUsd,
    duration_ms: Date.now() - ctx.startedAt, ended_at: now(),
  })
  await ctx.crud.eventCreate(ctx.ctx, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_' + status,
    data: JSON.stringify({ duration_ms: Date.now() - ctx.startedAt, cost_usd: r.costUsd }),
    caused_by: 'runtime',
  })
}

async function finalizeFailedSession(ctx: SessionContext, errVal: unknown): Promise<void> {
  const msg = errVal instanceof Error ? errVal.message : String(errVal)
  await ctx.crud.sessionUpdateById(ctx.ctx, ctx.session.id, {
    status: 'failed', error: msg,
    duration_ms: Date.now() - ctx.startedAt, ended_at: now(),
  })
  await ctx.crud.eventCreate(ctx.ctx, {
    entity_type: 'session', entity_id: ctx.session.id,
    kind: 'session_failed',
    data: JSON.stringify({ error: msg }),
    caused_by: 'runtime',
  })
}
