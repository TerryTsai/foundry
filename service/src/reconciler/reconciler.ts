// Reconciler — the only background process. Every 5s, walks each active
// project's non-terminal tickets and consults an ordered list of
// policies. First policy that takes an action wins for that ticket;
// subsequent policies in the list don't run for it this tick. Edit the
// POLICIES list to change reconciler behavior — that's the whole
// interface.
//
// All session execution lives under ./session/. The reconciler's job is
// purely "what should run next"; it never executes a session itself.

import { eq } from 'drizzle-orm'
import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import * as schema from '../core/schema.js'
import { now } from '../core/util.js'
import { agentList } from '@foundry/crud'

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

export async function reconcilerTick(db: Db): Promise<void> {
  for (const project of database.projectsActive(db)) {
    // build per-project context once
    const agents = agentList(db, { accountId: project.owner_id })
    const ticketsByStatus = (status: string) =>
      database.ticketAll(db, [eq(schema.ticket.project_id, project.id), eq(schema.ticket.status, status)])
    const running = ticketsByStatus('running')
    const slots   = { remaining: project.max_agents - running.length }

    // FIFO across non-terminal tickets — whatever waited longest goes first
    const queue = [...running, ...ticketsByStatus('waiting'), ...ticketsByStatus('created')]
      .sort((a, b) => {
        const ea = database.eventLatest(db, 'ticket', a.id)?.created_at ?? '1970-01-01'
        const eb = database.eventLatest(db, 'ticket', b.id)?.created_at ?? '1970-01-01'
        return ea.localeCompare(eb)
      })

    // walk each ticket through the policy list — first match acts, rest skip
    for (const ticket of queue) {
      const ctx = { db, project, agents, ticket, slots }
      for (const policy of POLICIES) {
        if (policy(ctx) === 'acted') break
      }
    }
  }
}

// ── lifecycle ────────────────────────────────────────────────────────

let globalInterval: ReturnType<typeof setInterval> | null = null

export function reconcilerGlobalStart(db: Db): void {
  if (globalInterval) return
  globalInterval = setInterval(() => {
    reconcilerTick(db).catch((err: unknown) =>
      console.error('reconciler error:', err))
  }, 5000)
}

export function reconcilerStopAll(): void {
  if (globalInterval) { clearInterval(globalInterval); globalInterval = null }
}

export function shutdownDrain(db: Db): void {
  const running = database.sessionRunning(db)
  for (const s of running) {
    database.sessionUpdate(db, s.id, {
      status: 'failed', error: 'deploy-restart', ended_at: now(),
    })
    const t = database.ticketGet(db, s.ticket_id)
    if (t?.status === 'running') {
      database.ticketUpdate(db, t.id, { status: 'waiting', updated_at: now() })
    }
  }
  if (running.length) console.log(`drained ${running.length} running session(s)`)
}
