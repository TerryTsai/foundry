import { type Db } from '@foundry/db'
import type { Agent, Project, Ticket } from '@foundry/db'
import { now } from '@foundry/model'

import type { ReconcilerDeps } from '../types.js'

// ── shape ────────────────────────────────────────────────────────────
// Each policy receives the same context: the project being reconciled,
// its agents, the ticket under consideration, and a mutable slots
// counter (decremented by dispatching policies as they consume a slot).
//
// 'acted'  → policy made a state change for this ticket; reconciler
//            stops walking the policy list for this tick.
// 'pass'   → policy was not applicable; reconciler tries the next.

export interface PolicyCtx {
  db:      Db
  deps:    ReconcilerDeps
  project: Project
  agents:  Agent[]
  ticket:  Ticket
  slots:   { remaining: number }   // mutable across policies/tickets within a project tick
}

export type Policy = (ctx: PolicyCtx) => 'acted' | 'pass'

// ── shared effects ───────────────────────────────────────────────────

// Transition a ticket from `from` → `to`. Records a status_changed event
// on success (returns true). Returns false if the current status doesn't
// match `from` (race with another tick or operator action).
export function transition(
  db: Db, deps: ReconcilerDeps,
  ticketId: string, from: string, to: string,
  causedBy: string, data?: Record<string, unknown>,
): boolean {
  if (!deps.crud.ticketTransition(db, ticketId, from, to)) return false
  deps.crud.eventCreate(db, {
    entity_type: 'ticket', entity_id: ticketId,
    kind: 'status_changed',
    data: JSON.stringify({ from, to, ...data }),
    caused_by: causedBy,
  })
  return true
}

// Insert a session row, fire the started event, and dispatch the runner
// in the background (fire-and-forget — the runner emits its own events
// when it terminates). The composition root supplies runSession +
// engineDeps via deps, so the reconciler itself never imports engine.
export function dispatchSession(
  db: Db, deps: ReconcilerDeps, ticket: Ticket, agent: Agent, role: 'producer' | 'verifier',
): void {
  const sess = deps.crud.sessionInsert(db, {
    ticket_id: ticket.id, agent_id: agent.id,
    status: 'running', started_at: now(),
  })
  deps.crud.eventCreate(db, {
    entity_type: 'session', entity_id: sess.id,
    kind: 'started',
    data: JSON.stringify({ role, ticket_id: ticket.id, agent_name: agent.name }),
    caused_by: 'reconciler',
  })
  deps.engine.runSession(db, deps.config, deps.engine.engineDeps, sess.id, agent, ticket, role)
    .catch((err: unknown) => console.error(`session ${sess.id} crashed:`, err))
}

// Parse the JSON-encoded verifier id list off an agent row.
export function parseVerifierIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
