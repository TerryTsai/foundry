import { type Policy, type PolicyCtx, transition, dispatchSession, parseVerifierIds, currentRoundVerifierSessions } from './shared.js'
import type { Agent } from '@foundry/db'

// Ticket is in waiting, verifiers are configured, and at least one
// declared verifier hasn't been dispatched for the current round
// (post the latest producer session). Send the next missing one.
export const dispatchVerifier: Policy = (ctx) => {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const sessions = currentRoundVerifierSessions(ctx)
  if (sessions === null) return 'pass'
  const dispatched = new Set(sessions.map(s => s.agent_id))
  return dispatchNextMissing(ctx, verifierIds, dispatched)
}

function dispatchNextMissing(ctx: PolicyCtx, verifierIds: string[], dispatched: Set<string>): 'acted' | 'pass' {
  for (const vid of verifierIds) {
    if (dispatched.has(vid)) continue
    const verifier = ctx.agents.find(a => a.id === vid)
    if (!verifier) continue
    if (ctx.slots.remaining <= 0) return 'pass'
    if (sendVerifier(ctx, verifier)) return 'acted'
    return 'pass'
  }
  return 'pass'
}

function sendVerifier(ctx: PolicyCtx, verifier: Agent): boolean {
  if (!transition(ctx.db, ctx.deps, ctx.ticket.id, 'waiting', 'running', 'reconciler', { reason: 'verifier', verifier_name: verifier.name })) return false
  ctx.slots.remaining--
  dispatchSession(ctx.db, ctx.deps, { ...ctx.ticket, status: 'running' }, verifier, 'verifier')
  return true
}
