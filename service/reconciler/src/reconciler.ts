// Reconciler — pure ticker. Every call walks each active project's
// non-terminal tickets through the policy list passed in by the
// composition root. First policy that takes an action wins for that
// ticket; subsequent policies in the list don't run for it this tick.
//
// Lifecycle (interval start/stop, on-demand trigger callback) is owned
// by @foundry/server. Reconciler itself holds no module-level state.

import { type Db } from '@foundry/db'
import type { Project, Ticket } from '@foundry/db'
import type { Ctx } from '@foundry/model'
import { now } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'
import type { EngineClient } from '@foundry/engine/client'

import type { Policy, PolicyCtx } from './schema.js'

// ── tick ─────────────────────────────────────────────────────────────

export async function reconcilerTick(
  ctx: Ctx, db: Db, crud: CrudClient, engine: EngineClient, policies: Policy[],
): Promise<void> {
  const projectsR = await crud.projectsActive(ctx)
  if (!projectsR.ok) return
  for (const project of projectsR.value) {
    await tickProject(ctx, db, crud, engine, project, policies)
  }
}

// Walk every non-terminal ticket in one project through the policy list.
async function tickProject(
  ctx: Ctx, db: Db, crud: CrudClient, engine: EngineClient,
  project: Project, policies: Policy[],
): Promise<void> {
  const agentsR  = await crud.agentListInternal(ctx, project.owner_id)
  const agents   = agentsR.ok ? agentsR.value : []
  const running  = await ticketsByStatus(ctx, crud, project.id, 'running')
  const waiting  = await ticketsByStatus(ctx, crud, project.id, 'waiting')
  const created  = await ticketsByStatus(ctx, crud, project.id, 'created')
  const slots    = { remaining: project.max_agents - running.length }

  // FIFO across non-terminal tickets — whatever waited longest goes first
  const candidates = [...running, ...waiting, ...created]
  const queue = await sortByLatestEvent(ctx, crud, candidates)

  for (const ticket of queue) {
    await runPolicies({ ctx, db, crud, engine, project, agents, ticket, slots }, policies)
  }
}

async function ticketsByStatus(ctx: Ctx, crud: CrudClient, projectId: string, status: string): Promise<Ticket[]> {
  const r = await crud.ticketAllByProject(ctx, projectId, status)
  return r.ok ? r.value : []
}

async function sortByLatestEvent(ctx: Ctx, crud: CrudClient, tickets: Ticket[]): Promise<Ticket[]> {
  const stamps = await Promise.all(tickets.map(async (t) => {
    const r = await crud.eventLatest(ctx, 'ticket', t.id)
    return { ticket: t, stamp: (r.ok && r.value?.created_at) ? r.value.created_at : '1970-01-01' }
  }))
  return stamps.sort((a, b) => a.stamp.localeCompare(b.stamp)).map(s => s.ticket)
}

// First policy that returns 'acted' wins for this ticket; later policies don't run.
async function runPolicies(ctx: PolicyCtx, policies: Policy[]): Promise<void> {
  for (const policy of policies) {
    if ((await policy(ctx)) === 'acted') return
  }
}

// ── shutdown ─────────────────────────────────────────────────────────

export async function shutdownDrain(ctx: Ctx, crud: CrudClient): Promise<void> {
  const r = await crud.sessionRunning(ctx)
  if (!r.ok) return
  const running = r.value
  for (const s of running) {
    await crud.sessionUpdateById(ctx, s.id, {
      status: 'failed', error: 'deploy-restart', ended_at: now(),
    })
    const tR = await crud.ticketGetById(ctx, s.ticket_id)
    const t  = tR.ok ? tR.value : undefined
    if (t?.status === 'running') {
      await crud.ticketUpdateById(ctx, t.id, { status: 'waiting', updated_at: now() })
    }
  }
  if (running.length) console.log(`drained ${running.length} running session(s)`)
}
