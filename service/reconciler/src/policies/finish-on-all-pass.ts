import { type PolicyCtx, transition, parseVerifierIds, currentRoundVerifierSessions } from './shared.js'
import type { Session } from '@foundry/db'

// Ticket in waiting, every configured verifier has run for the current
// round, and every verdict came back pass. Settle as finished.
export function finishOnAllPass(ctx: PolicyCtx): 'acted' | 'pass' {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const verifierSessions = currentRoundVerifierSessions(ctx)
  if (!verifierSessions || verifierSessions.length < verifierIds.length) return 'pass'
  return checkAndFinish(ctx, verifierSessions)
}

function checkAndFinish(ctx: PolicyCtx, verifierSessions: Session[]): 'acted' | 'pass' {
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'
  const verdicts = verifierSessions
    .map(s => ctx.deps.crud.verdictBySession(ctx.db, s.id))
    .filter((v): v is NonNullable<typeof v> => v != null)
  if (verdicts.length === 0) return 'pass'
  if (!verdicts.every(v => v.pass)) return 'pass'
  const verifierNames = verdicts.map(v => ctx.agents.find(a => a.id === v.agent_id)?.name ?? v.agent_id)
  return transition(ctx.db, ctx.deps, ctx.ticket.id, 'waiting', 'finished', 'reconciler', { verified_by: verifierNames }) ? 'acted' : 'pass'
}
