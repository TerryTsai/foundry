// Verifier-only: after the session ends, ensure a verdict row exists for
// this (ticket, session). A silent verifier (ended without calling
// verdictReport) or a crashed one gets a fail-closed synthetic verdict
// so the next producer's prompt surfaces the reason. Silent = failed
// review, never implicit approval.

import type { SessionContext, SessionStep } from '../schema.js'

export function failVerdictOnSilence(next: SessionStep): SessionStep {
  return async (ctx) => {
    try { await next(ctx) }
    finally { await synthesizeIfSilent(ctx) }
    return ctx
  }
}

// Skip synthesis on cancel: the Claude Agent SDK keeps draining in-flight
// MCP tool calls after we break out of the loop, so a real verdictReport
// can still land seconds later. Writing a synthetic fail here would
// shadow it. A cancelled verifier is inconclusive, not failed — the
// orchestrator halts the dance instead.
async function synthesizeIfSilent(ctx: SessionContext): Promise<void> {
  if (ctx.result?.cancelled) return
  const r = await ctx.deps.verdictBySession(ctx.ctx, ctx.session.id)
  if (!r.ok || r.value) return
  const reason = ctx.result
    ? 'verifier ended without reporting a verdict'
    : 'verifier crashed before reporting a verdict'
  await ctx.deps.sessionUpdateById(ctx.ctx, ctx.session.id, {
    verdict_pass:   false,
    verdict_reason: reason,
  })
}
