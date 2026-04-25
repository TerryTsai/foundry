// Reconciler — the only background process. Every 5s, walks each active
// project's non-terminal tickets and consults an ordered list of
// policies. First policy that takes an action wins for that ticket;
// subsequent policies in the list don't run for it this tick. Edit the
// POLICIES list to change reconciler behavior — that's the whole
// interface.
//
// Reconciler never executes a session itself — runSession arrives via
// ReconcilerDeps from the composition root. Persistence access is also
// dep-injected (no direct @foundry/db imports).

import { type Db } from '@foundry/db'
import type { Agent, Project, Ticket } from '@foundry/db'
import { now } from '@foundry/model'

import type { ReconcilerDeps } from './types.js'

import { dispatchProducer }         from './policies/dispatch-producer.js'
import { settleRunning }            from './policies/settle-running.js'
import { dispatchRecoveryProducer } from './policies/dispatch-recovery-producer.js'
import { finishWithoutVerifiers }   from './policies/finish-without-verifiers.js'
import { dispatchVerifier }         from './policies/dispatch-verifier.js'
import { finishOnAllPass }          from './policies/finish-on-all-pass.js'
import { retryAfterFail }           from './policies/retry-after-fail.js'

// Order matters — earlier policies pre-empt later ones for the same
// ticket. Most policies have mutually exclusive guards (status +
// verdicts state), so reordering rarely changes behavior. The exception:
// finish-on-all-pass and retry-after-fail both apply to "all verifiers
// done" — finish runs first because all-pass is the happy path; retry
// takes whatever falls through.
const POLICIES = [
  dispatchProducer,            // created → dispatch producer (slot allowing)
  settleRunning,               // running with no live session → waiting
  dispatchRecoveryProducer,    // waiting + no producer ever → dispatch one
  finishWithoutVerifiers,      // waiting + no verifiers configured → settle
  dispatchVerifier,            // waiting → dispatch a missing verifier
  finishOnAllPass,             // waiting + all verifiers passed → finished
  retryAfterFail,              // waiting + any verifier failed → reset + new producer
]

// ── tick ─────────────────────────────────────────────────────────────

export async function reconcilerTick(db: Db, deps: ReconcilerDeps): Promise<void> {
  for (const project of deps.crud.projectsActive(db)) {
    tickProject(db, deps, project)
  }
}

// Walk every non-terminal ticket in one project through the policy list.
function tickProject(db: Db, deps: ReconcilerDeps, project: Project): void {
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
    runPolicies({ db, deps, project, agents, ticket, slots })
  }
}

// First policy that returns 'acted' wins for this ticket; later policies don't run.
function runPolicies(ctx: { db: Db; deps: ReconcilerDeps; project: Project; agents: Agent[]; ticket: Ticket; slots: { remaining: number } }): void {
  for (const policy of POLICIES) {
    if (policy(ctx) === 'acted') return
  }
}

// ── lifecycle ────────────────────────────────────────────────────────

let globalInterval: ReturnType<typeof setInterval> | null = null
let globalDeps: ReconcilerDeps | null = null

export function reconcilerGlobalStart(db: Db, deps: ReconcilerDeps): void {
  if (globalInterval) return
  globalDeps = deps
  globalInterval = setInterval(() => {
    reconcilerTick(db, deps).catch((err: unknown) =>
      console.error('reconciler error:', err))
  }, 5000)
}

export function reconcilerStopAll(): void {
  if (globalInterval) { clearInterval(globalInterval); globalInterval = null }
  globalDeps = null
}

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

// Cached deps accessor for callers (e.g. routes) that need to invoke
// reconcilerTick on demand without re-threading deps. Set during
// reconcilerGlobalStart; cleared by reconcilerStopAll.
export function reconcilerDepsActive(): ReconcilerDeps | null {
  return globalDeps
}
