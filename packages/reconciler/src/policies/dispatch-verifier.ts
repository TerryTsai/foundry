import { type Policy, transition, dispatchSession, parseVerifierIds } from './shared.js'

// Ticket is in waiting, verifiers are configured, and at least one
// declared verifier hasn't been dispatched for the current round
// (post the latest producer session). Send the next missing one.
export const dispatchVerifier: Policy = (ctx) => {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'waiting') return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  const verifierIds = parseVerifierIds(agent.verifiers)
  if (verifierIds.length === 0) return 'pass'

  const sessions = deps.crud.sessionsByTicketRaw(db, ticket.id)
  const producers = sessions.filter(s => s.agent_id === ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return 'pass'   // recovery-producer policy handles this case

  // verifiers belonging to the current round = run after the latest producer
  const dispatched = new Set(
    sessions
      .filter(s => s.agent_id !== ticket.agent_id && s.started_at >= latestProducer.started_at)
      .map(s => s.agent_id),
  )

  for (const vid of verifierIds) {
    if (dispatched.has(vid)) continue
    const verifier = agents.find(a => a.id === vid)
    if (!verifier) continue
    if (slots.remaining <= 0) return 'pass'
    if (!transition(db, deps, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'verifier', verifier_name: verifier.name })) return 'pass'
    slots.remaining--
    dispatchSession(db, deps, { ...ticket, status: 'running' }, verifier, 'verifier')
    return 'acted'
  }
  return 'pass'   // every verifier already dispatched
}
