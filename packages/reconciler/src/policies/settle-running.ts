import { type Policy, transition } from './shared.js'

// Ticket marked running but no live session → the runner exited (success
// or crash) without anything pulling the ticket back. Move it to waiting
// so the verifier / verdict / retry policies can take over next tick.
export const settleRunning: Policy = (ctx) => {
  const { db, deps, ticket } = ctx
  if (ticket.status !== 'running') return 'pass'
  if (deps.crud.sessionRunningForTicket(db, ticket.id).length > 0) return 'pass'
  return transition(db, deps, ticket.id, 'running', 'waiting', 'reconciler') ? 'acted' : 'pass'
}
