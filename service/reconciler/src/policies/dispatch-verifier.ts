import { type PolicyCtx, transition, dispatchSession, parseVerifierIds, currentRoundVerifierSessions } from './shared.js'
import type { Agent } from '@foundry/db'

// Ticket is in waiting, verifiers are configured, and at least one
// declared verifier hasn't been dispatched for the current round
// (post the latest producer session). Send the next missing one.
export async function dispatchVerifier(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const sessions = await currentRoundVerifierSessions(ctx)
  if (sessions === null) return 'pass'
  const dispatched = new Set(sessions.map(s => s.agent_id))
  return dispatchNextMissing(ctx, verifierIds, dispatched)
}

async function dispatchNextMissing(ctx: PolicyCtx, verifierIds: string[], dispatched: Set<string>): Promise<'acted' | 'pass'> {
  for (const vid of verifierIds) {
    if (dispatched.has(vid)) continue
    const verifier = ctx.agents.find(a => a.id === vid)
    if (!verifier) continue
    if (ctx.slots.remaining <= 0) return 'pass'
    if (await sendVerifier(ctx, verifier)) return 'acted'
    return 'pass'
  }
  return 'pass'
}

async function sendVerifier(ctx: PolicyCtx, verifier: Agent): Promise<boolean> {
  if (!(await transition(ctx.ctx, ctx.deps, ctx.ticket.id, 'waiting', 'running', 'reconciler', { reason: 'verifier', verifier_name: verifier.name }))) return false
  ctx.slots.remaining--
  await dispatchSession(ctx.ctx, ctx.db, ctx.deps, { ...ctx.ticket, status: 'running' }, verifier, 'verifier')
  return true
}
