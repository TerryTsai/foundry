import { type PolicyCtx, transition, parseVerifierIds } from './shared.js'

// Ticket is in waiting and the assigned agent declares no verifiers.
// Settle the ticket from the latest producer session's outcome —
// finished if the producer succeeded, failed if it crashed.
export function finishWithoutVerifiers(ctx: PolicyCtx): 'acted' | 'pass' {
  const { db, deps, ticket, agents } = ctx
  if (ticket.status !== 'waiting') return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'
  if (parseVerifierIds(agent.verifiers).length > 0) return 'pass'

  const sessions = deps.crud.sessionsByTicketRaw(db, ticket.id)
  const producers = sessions.filter(s => s.agent_id === ticket.agent_id)
  const latest = producers[producers.length - 1]
  if (!latest) return 'pass'
  if (latest.status === 'finished') return transition(db, deps, ticket.id, 'waiting', 'finished', 'reconciler') ? 'acted' : 'pass'
  if (latest.status === 'failed')   return transition(db, deps, ticket.id, 'waiting', 'failed',   'reconciler') ? 'acted' : 'pass'
  return 'pass'   // producer still running — try again next tick
}
