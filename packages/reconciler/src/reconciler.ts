// Reconciler — pure ticker. Every call walks each active project's
// non-terminal tickets through the policy list passed in by the
// composition root. First policy that takes an action wins for that
// ticket; subsequent policies in the list don't run for it this tick.
//
// Lifecycle (interval start/stop, on-demand trigger callback) is owned
// by @foundry/server. Reconciler itself holds no module-level state.

import { type Db } from '@foundry/db'
import type { Project } from '@foundry/db'
import { now } from '@foundry/model'

import type { ReconcilerDeps, Policy, PolicyCtx } from './schema.js'

// ── tick ─────────────────────────────────────────────────────────────

export async function reconcilerTick(db: Db, deps: ReconcilerDeps, policies: Policy[]): Promise<void> {
  for (const project of deps.crud.projectsActive(db)) {
    tickProject(db, deps, project, policies)
  }
}

// Walk every non-terminal ticket in one project through the policy list.
function tickProject(db: Db, deps: ReconcilerDeps, project: Project, policies: Policy[]): void {
  const agents = deps.crud.agentList(db, { accountId: project.owner_id })
  const ticketsByStatus = (status: string) => deps.crud.ticketAllByProject(db, project.id, status)
  const running = ticketsByStatus('running')
  const slots   = { remaining: project.max_agents - running.length }

  // FIFO across non-terminal tickets — whatever waited longest goes first
  const queue = [...running, ...ticketsByStatus('waiting'), ...ticketsByStatus('created')]
    .sort((a, b) => {
      const ea = deps.crud.eventLatest(db, 'ticket', a.id)?.created_at ?? '1970-01-01'
      const eb = deps.crud.eventLatest(db, 'ticket', b.id)?.created_at ?? '1970-01-01'
      return ea.localeCompare(eb)
    })

  for (const ticket of queue) {
    runPolicies({ db, deps, project, agents, ticket, slots }, policies)
  }
}

// First policy that returns 'acted' wins for this ticket; later policies don't run.
function runPolicies(ctx: PolicyCtx, policies: Policy[]): void {
  for (const policy of policies) {
    if (policy(ctx) === 'acted') return
  }
}

// ── shutdown ─────────────────────────────────────────────────────────

export function shutdownDrain(db: Db, deps: ReconcilerDeps): void {
  const running = deps.crud.sessionRunning(db)
  for (const s of running) {
    deps.crud.sessionUpdateById(db, s.id, {
      status: 'failed', error: 'deploy-restart', ended_at: now(),
    })
    const t = deps.crud.ticketGetById(db, s.ticket_id)
    if (t?.status === 'running') {
      deps.crud.ticketUpdateById(db, t.id, { status: 'waiting', updated_at: now() })
    }
  }
  if (running.length) console.log(`drained ${running.length} running session(s)`)
}
