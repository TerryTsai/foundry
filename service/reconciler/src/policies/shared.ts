import { type Db } from '@foundry/db'
import type { Agent, Session, Ticket } from '@foundry/db'
import { now } from '@foundry/model'
import type { Ctx } from '@foundry/model'

import type { ReconcilerDeps, PolicyCtx } from '../schema.js'

// Re-exports so policy files have a single import surface for the
// types + helpers they use. The actual declarations live in schema.ts.
export type { Policy, PolicyCtx } from '../schema.js'

// ── shared effects ───────────────────────────────────────────────────

// Transition a ticket from `from` → `to`. Records a status_changed event
// on success (returns true). Returns false if the current status doesn't
// match `from` (race with another tick or operator action).
export async function transition(
  ctx: Ctx, deps: ReconcilerDeps,
  ticketId: string, from: string, to: string,
  causedBy: string, data?: Record<string, unknown>,
): Promise<boolean> {
  const r = await deps.crud.ticketTransition(ctx, ticketId, from, to)
  if (!r.ok || !r.value) return false
  await deps.crud.eventCreate(ctx, {
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
export async function dispatchSession(
  ctx: Ctx, db: Db, deps: ReconcilerDeps, ticket: Ticket, agent: Agent, role: 'producer' | 'verifier',
): Promise<void> {
  const sessR = await deps.crud.sessionInsert(ctx, {
    ticket_id: ticket.id, agent_id: agent.id,
    status: 'running', started_at: now(),
  })
  if (!sessR.ok) return
  const sess = sessR.value
  await deps.crud.eventCreate(ctx, {
    entity_type: 'session', entity_id: sess.id,
    kind: 'started',
    data: JSON.stringify({ role, ticket_id: ticket.id, agent_name: agent.name }),
    caused_by: 'reconciler',
  })
  void runSessionAsync(ctx, db, deps, sess.id, agent, ticket, role)
}

async function runSessionAsync(
  ctx: Ctx, db: Db, deps: ReconcilerDeps, sessionId: string, agent: Agent, ticket: Ticket, role: 'producer' | 'verifier',
): Promise<void> {
  try {
    const r = await deps.engine.runSession(ctx, db, deps.config, deps.engine.engineDeps, sessionId, agent, ticket, role)
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
export async function currentRoundVerifierSessions(ctx: PolicyCtx): Promise<Session[] | null> {
  const r = await ctx.deps.crud.sessionsByTicketRaw(ctx.ctx, ctx.ticket.id)
  if (!r.ok) return null
  const sessions = r.value
  const producers = sessions.filter(s => s.agent_id === ctx.ticket.agent_id)
  const latestProducer = producers[producers.length - 1]
  if (!latestProducer) return null
  return sessions.filter(s => s.agent_id !== ctx.ticket.agent_id && s.started_at >= latestProducer.started_at)
}
