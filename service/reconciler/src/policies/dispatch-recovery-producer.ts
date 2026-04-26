import { type PolicyCtx, transition, dispatchSession } from './shared.js'

// Ticket is in waiting but no producer session has ever run for it
// (rare — usually means the dispatch landed during a crash or a manual
// status edit dropped it into waiting). Send a fresh producer.
export function dispatchRecoveryProducer(ctx: PolicyCtx): 'acted' | 'pass' {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'waiting') return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  const sessions = deps.crud.sessionsByTicketRaw(db, ticket.id)
  const hasProducer = sessions.some(s => s.agent_id === ticket.agent_id)
  if (hasProducer) return 'pass'

  if (slots.remaining <= 0) return 'pass'
  if (!transition(db, deps, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' })) return 'pass'
  slots.remaining--
  dispatchSession(db, deps, { ...ticket, status: 'running' }, agent, 'producer')
  return 'acted'
}
