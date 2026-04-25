import { type Policy, type PolicyCtx, transition, dispatchSession, parseVerifierIds } from './shared.js'
import type { Agent, Session } from '@foundry/db'

// Ticket is in waiting, verifiers are configured, and at least one
// declared verifier hasn't been dispatched for the current round
// (post the latest producer session). Send the next missing one.
export const dispatchVerifier: Policy = (ctx) => {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const dispatched = currentRoundVerifierIds(ctx)
  if (dispatched === null) return 'pass'
  return dispatchNextMissing(ctx, verifierIds, dispatched)
}

function currentRoundVerifierIds(ctx: PolicyCtx): Set<string> | null {
  const sessions = ctx.deps.crud.sessionsByTicketRaw(ctx.db, ctx.ticket.id)
  const producers = sessions.filter(s => s.agent_id === ctx.ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return null
  return new Set(roundVerifierSessions(sessions, ctx.ticket.agent_id, latestProducer).map(s => s.agent_id))
}

function roundVerifierSessions(sessions: Session[], producerAgentId: string | null, latestProducer: Session): Session[] {
  return sessions.filter(s => s.agent_id !== producerAgentId && s.started_at >= latestProducer.started_at)
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
