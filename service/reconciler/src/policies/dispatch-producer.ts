import { type PolicyCtx, transition, dispatchSession } from './shared.js'

// Newly-created ticket → dispatch its assigned producer agent if a slot
// is available and any depends_on prerequisite is finished.
export async function dispatchProducer(ctx: PolicyCtx): Promise<'acted' | 'pass'> {
  const { db, deps, ticket, agents, slots } = ctx
  if (ticket.status !== 'created') return 'pass'
  if (slots.remaining <= 0)        return 'pass'
  if (!ticket.agent_id)            return 'pass'

  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return 'pass'

  if (ticket.depends_on) {
    const depR = await deps.crud.ticketGetById(ctx.ctx, ticket.depends_on)
    const dep  = depR.ok ? depR.value : undefined
    if (!dep || dep.status !== 'finished') return 'pass'
  }

  if (!(await transition(ctx.ctx, deps, ticket.id, 'created', 'running', 'reconciler'))) return 'pass'
  slots.remaining--
  await dispatchSession(ctx.ctx, db, deps, { ...ticket, status: 'running' }, agent, 'producer')
  return 'acted'
}
