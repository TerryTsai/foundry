import { type PolicyCtx, transition } from './shared.js'

// Ticket marked running but no live session → the runner exited (success
// or crash) without anything pulling the ticket back. Move it to waiting
// so the verifier / verdict / retry policies can take over next tick.
export async function settleRunning(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  const { deps, ticket } = ctx
  if (ticket.status !== 'running') return 'pass'
  const r = await deps.sessionRunningForTicket(ctx.ctx, ticket.id)
  if (!r.ok) return 'pass'
  if (r.value.length > 0) return 'pass'
  return (await transition(ctx.ctx, deps, ticket.id, 'running', 'waiting', 'reconciler')) ? 'acted' : 'pass'
}
