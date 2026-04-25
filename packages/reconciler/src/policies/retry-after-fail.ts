import { type Policy, type PolicyCtx, transition, dispatchSession, parseVerifierIds } from './shared.js'
import type { Agent, Session } from '@foundry/db'

// Ticket in waiting, all verifiers in the current round have run, and
// at least one came back fail (or no verdict at all). Reset the round
// and dispatch a new producer.
export const retryAfterFail: Policy = (ctx) => {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const verifierSessions = currentRoundVerifierSessions(ctx)
  if (!verifierSessions || verifierSessions.length < verifierIds.length) return 'pass'
  return processVerdicts(ctx, verifierSessions, agent)
}

function currentRoundVerifierSessions(ctx: PolicyCtx): Session[] | null {
  const sessions = ctx.deps.crud.sessionsByTicketRaw(ctx.db, ctx.ticket.id)
  const producers = sessions.filter(s => s.agent_id === ctx.ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return null
  return sessions.filter(s => s.agent_id !== ctx.ticket.agent_id && s.started_at >= latestProducer.started_at)
}

function processVerdicts(ctx: PolicyCtx, verifierSessions: Session[], agent: Agent): 'acted' | 'pass' {
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'
  const verdicts = verifierSessions
    .map(s => ctx.deps.crud.verdictBySession(ctx.db, s.id))
    .filter((v): v is NonNullable<typeof v> => v != null)
  if (verdicts.length > 0 && verdicts.every(v => v.pass)) return 'pass'
  return retryRound(ctx, agent)
}

function retryRound(ctx: PolicyCtx, agent: Agent): 'acted' {
  transition(ctx.db, ctx.deps, ctx.ticket.id, 'waiting', 'waiting', 'reconciler', { reason: 'verdict_fail' })
  if (ctx.slots.remaining > 0 && transition(ctx.db, ctx.deps, ctx.ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' })) {
    ctx.slots.remaining--
    dispatchSession(ctx.db, ctx.deps, { ...ctx.ticket, status: 'running' }, agent, 'producer')
  }
  return 'acted'
}
