import { type PolicyCtx, transition, dispatchSession, parseVerifierIds, currentRoundVerifierSessions } from './shared.js'
import type { Agent, Session } from '@foundry/db'
import type { VerdictRow } from '../schema.js'

// Ticket in waiting, all verifiers in the current round have run, and
// at least one came back fail (or no verdict at all). Reset the round
// and dispatch a new producer.
export async function retryAfterFail(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  if (ctx.ticket.status !== 'waiting') return 'pass'
  const agent = ctx.agents.find(a => a.id === ctx.ticket.agent_id)
  if (!agent) return 'pass'
  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'
  const verifierSessions = await currentRoundVerifierSessions(ctx)
  if (!verifierSessions || verifierSessions.length < verifierIds.length) return 'pass'
  return processVerdicts(ctx, verifierSessions, agent)
}

async function processVerdicts(ctx: PolicyCtx, verifierSessions: Session[], agent: Agent): Promise<'acted' | 'pass'> {
  if (verifierSessions.some(s => s.status === 'running')) return 'pass'
  const verdicts: VerdictRow[] = []
  for (const s of verifierSessions) {
    const r = await ctx.deps.crud.verdictBySession(ctx.ctx, s.id)
    if (r.ok && r.value) verdicts.push(r.value)
  }
  if (verdicts.length > 0 && verdicts.every(v => v.pass)) return 'pass'
  return retryRound(ctx, agent)
}

async function retryRound(ctx: PolicyCtx, agent: Agent): Promise<'acted'> {
  await transition(ctx.ctx, ctx.deps, ctx.ticket.id, 'waiting', 'waiting', 'reconciler', { reason: 'verdict_fail' })
  if (ctx.slots.remaining > 0 && (await transition(ctx.ctx, ctx.deps, ctx.ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' }))) {
    ctx.slots.remaining--
    await dispatchSession(ctx.ctx, ctx.db, ctx.deps, { ...ctx.ticket, status: 'running' }, agent, 'producer')
  }
  return 'acted'
}
