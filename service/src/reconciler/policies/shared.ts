import { type Db } from '../../core/db.js'
import * as database from '../../core/db.js'
import type { Agent, Project, Ticket } from '../../core/schema.js'
import { now } from '../../core/util.js'

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
  db: Db, ticketId: string, from: string, to: string,
  causedBy: string, data?: Record<string, unknown>,
): boolean {
  if (!database.ticketTransition(db, ticketId, from, to)) return false
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: ticketId,
    kind: 'status_changed',
    data: JSON.stringify({ from, to, ...data }),
    caused_by: causedBy,
  })
  return true
}

// Insert a session row, fire the started event, and dispatch the runner
// in the background (fire-and-forget — the runner emits its own events
// when it terminates).
export function dispatchSession(
  db: Db, ticket: Ticket, agent: Agent, role: 'producer' | 'verifier',
): void {
  const sess = database.sessionInsert(db, {
    ticket_id: ticket.id, agent_id: agent.id,
    status: 'running', started_at: now(),
  })
  database.eventInsert(db, {
    entity_type: 'session', entity_id: sess.id,
    kind: 'started',
    data: JSON.stringify({ role, ticket_id: ticket.id, agent_name: agent.name }),
    caused_by: 'reconciler',
  })
  import('../session/session.js').then(({ runSession }) =>
    runSession(db, (globalThis as any).__foundryConfig, sess.id, agent, ticket, role)
      .catch((err: unknown) => console.error(`session ${sess.id} crashed:`, err))
  )
}

// Parse the JSON-encoded verifier id list off an agent row.
export function parseVerifierIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
