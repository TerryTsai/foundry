import { type PolicyCtx, transition, parseVerifierIds, currentRoundVerifierSessions } from './shared.js'
import type { Session } from '@foundry/db'
import type { VerdictRow } from '@foundry/crud'

// Ticket in waiting, every configured verifier has run for the current
// round, and every verdict came back pass. Settle as finished.
export async function finishOnAllPass(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const verifierSessions = await currentRoundVerifierSessions(ctx)
  if (!verifierSessions || verifierSessions.length < verifierIds.length) return 'pass'
  return checkAndFinish(ctx, verifierSessions)
}

async function checkAndFinish(ctx: PolicyCtx, verifierSessions: Session[]): Promise<'acted' | 'pass'> {
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'
  const verdicts: VerdictRow[] = []
  for (const s of verifierSessions) {
    const r = await ctx.crud.verdictBySession(ctx.ctx, s.id)
    if (r.ok && r.value) verdicts.push(r.value)
  }
  if (verdicts.length === 0) return 'pass'
  if (!verdicts.every(v => v.pass)) return 'pass'
  const verifierNames = verdicts.map(v => ctx.agents.find(a => a.id === v.agent_id)?.name ?? v.agent_id)
  return (await transition(ctx.ctx, ctx.crud, ctx.ticket.id, 'waiting', 'finished', 'reconciler', { verified_by: verifierNames })) ? 'acted' : 'pass'
}
