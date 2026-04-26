import { type Db } from '@foundry/db'
import type { Agent, Session, Ticket } from '@foundry/db'
import { now } from '@foundry/model'

import type { ReconcilerDeps, PolicyCtx } from '../schema.js'

// Re-exports so policy files have a single import surface for the
// types + helpers they use. The actual declarations live in schema.ts.
export type { Policy, PolicyCtx } from '../schema.js'

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
  void runSessionAsync(db, deps, sess.id, agent, ticket, role)
}

async function runSessionAsync(
  db: Db, deps: ReconcilerDeps, sessionId: string, agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<void> {
  try {
    const r = await deps.engine.runSession(db, deps.config, deps.engine.engineDeps, sessionId, agent, ticket, role)
    if (!r.ok) console.error(`session ${sessionId} returned err:`, r.error)
  } catch (errVal) {
    console.error(`session ${sessionId} crashed:`, errVal)
  }
}

// Parse the JSON-encoded verifier id list off an agent row.
export function parseVerifierIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

// Verifier sessions for the current round — i.e. since the latest
// producer session started. Returns null if no producer has run for
// this ticket yet (callers treat that as "not applicable, pass").
//
// Multiple policies (dispatchVerifier, finishOnAllPass, retryAfterFail)
// need this same window when deciding whether to dispatch the next
// missing verifier or settle the round. Single source of truth here so
// the round semantics can't drift between policies.
export function currentRoundVerifierSessions(ctx: PolicyCtx): Session[] | null {
  const sessions = ctx.deps.crud.sessionsByTicketRaw(ctx.db, ctx.ticket.id)
  const producers = sessions.filter(s => s.agent_id === ctx.ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return null
  return sessions.filter(s => s.agent_id !== ctx.ticket.agent_id && s.started_at >= latestProducer.started_at)
}
