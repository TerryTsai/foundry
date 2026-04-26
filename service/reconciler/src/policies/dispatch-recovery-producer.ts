import { type PolicyCtx, transition, dispatchSession } from './shared.js'

// Ticket is in waiting but no producer session has ever run for it
// (rare — usually means the dispatch landed during a crash or a manual
// status edit dropped it into waiting). Send a fresh producer.
export async function dispatchRecoveryProducer(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'waiting') return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  const sessR = await deps.sessionsByTicketRaw(ctx.ctx, ticket.id)
  const sessions = sessR.ok ? sessR.value : []
  const hasProducer = sessions.some(s => s.agent_id === ticket.agent_id)
  if (hasProducer) return 'pass'

  if (slots.remaining <= 0) return 'pass'
  if (!(await transition(ctx.ctx, deps, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' }))) return 'pass'
  slots.remaining--
  await dispatchSession(ctx.ctx, db, deps, { ...ticket, status: 'running' }, agent, 'producer')
  return 'acted'
}
