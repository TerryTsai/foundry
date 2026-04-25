import { type Policy, transition, dispatchSession } from './shared.js'

// Newly-created ticket → dispatch its assigned producer agent if a slot
// is available and any depends_on prerequisite is finished.
export const dispatchProducer: Policy = (ctx) => {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'created') return 'pass'
  if (slots.remaining <= 0)        return 'pass'
  if (!ticket.agent_id)            return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  if (ticket.depends_on) {
    const dep = deps.crud.ticketGetById(db, ticket.depends_on)
    if (!dep || dep.status !== 'finished') return 'pass'
  }

  if (!transition(db, deps, ticket.id, 'created', 'running', 'reconciler')) return 'pass'
  slots.remaining--
  dispatchSession(db, deps, { ...ticket, status: 'running' }, agent, 'producer')
  return 'acted'
}
