// Reconciler: one loop, 5s interval. Replaces both the scheduler and
// the orchestrator. Evaluates every non-terminal ticket per active
// project and advances state based on conditions.
//
// Dispatch order: FIFO by last event timestamp — whatever has been
// waiting longest gets the next slot. Prevents starvation across
// producers and verifiers.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { now } from '../util.js'
import { ticketList } from './tickets.js'
import { agentList } from './agents.js'

function parseVerifiers(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

function lastEventTime(db: Db, ticketId: string): string {
  const ev = database.eventLatest(db, 'ticket', ticketId)
  return ev?.created_at ?? '1970-01-01T00:00:00.000Z'
}

function hasRunningSession(db: Db, ticketId: string): boolean {
  return database.sessionRunningForTicket(db, ticketId).length > 0
}

function transition(db: Db, ticketId: string, from: string, to: string, causedBy: string, data?: Record<string, unknown>): boolean {
  if (!database.ticketTransition(db, ticketId, from, to)) return false
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: ticketId,
    kind: 'status_changed',
    data: JSON.stringify({ from, to, ...data }),
    caused_by: causedBy,
  })
  return true
}

function dispatchSession(db: Db, ticket: Ticket, agent: AgentDef, role: 'producer' | 'verifier'): void {
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
  // Fire-and-forget: the session runner emits events when done.
  import('../runtime/ticket-run.js').then(({ runSession }) =>
    runSession(db, (globalThis as any).__foundryConfig, sess.id, agent, ticket, role)
      .catch((err: unknown) => console.error(`session ${sess.id} crashed:`, err))
  )
}

// ── Per-ticket evaluation ──

function evaluateCreated(db: Db, ticket: Ticket, agents: AgentDef[], slots: { remaining: number }): void {
  if (slots.remaining <= 0) return
  if (!ticket.agent_id) return
  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return

  if (ticket.depends_on) {
    const dep = database.ticketGet(db, ticket.depends_on)
    if (!dep || dep.status !== 'finished') return
  }

  if (!transition(db, ticket.id, 'created', 'running', 'reconciler')) return
  slots.remaining--
  dispatchSession(db, { ...ticket, status: 'running' }, agent, 'producer')
}

function evaluateRunning(db: Db, ticket: Ticket): void {
  if (hasRunningSession(db, ticket.id)) return
  transition(db, ticket.id, 'running', 'waiting', 'reconciler')
}

function evaluateWaiting(db: Db, ticket: Ticket, agents: AgentDef[], slots: { remaining: number }): void {
  const agent = agents.find(a => a.id === ticket.agent_id)
  if (!agent) return

  const verifierIds = parseVerifiers(agent.verifiers)
  const verdicts = database.verdictByTicket(db, ticket.id)

  // Find the latest producer session to determine the current round.
  const sessions = database.sessionsByTicketRaw(db, ticket.id)
  const producerSessions = sessions.filter(s => {
    // A producer session is one run by the ticket's assigned agent
    return s.agent_id === ticket.agent_id
  })
  const latestProducer = producerSessions[producerSessions.length - 1]
  if (!latestProducer) {
    // No producer has ever run — dispatch one
    if (slots.remaining <= 0) return
    if (!transition(db, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' })) return
    slots.remaining--
    dispatchSession(db, { ...ticket, status: 'running' }, agent, 'producer')
    return
  }

  // No verifiers configured — producer finishing = ticket finished
  if (verifierIds.length === 0) {
    if (latestProducer.status === 'finished') {
      transition(db, ticket.id, 'waiting', 'finished', 'reconciler')
    } else if (latestProducer.status === 'failed') {
      transition(db, ticket.id, 'waiting', 'failed', 'reconciler')
    }
    return
  }

  // Find verifier sessions from this round (started after latest producer)
  const verifierSessions = sessions.filter(s =>
    s.agent_id !== ticket.agent_id && s.started_at >= latestProducer.started_at
  )

  // Dispatch any missing verifiers
  const dispatchedVerifierAgentIds = new Set(verifierSessions.map(s => s.agent_id))
  for (const vid of verifierIds) {
    if (dispatchedVerifierAgentIds.has(vid)) continue
    const verifier = agents.find(a => a.id === vid)
    if (!verifier) continue
    if (slots.remaining <= 0) return
    if (!transition(db, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'verifier', verifier_name: verifier.name })) return
    slots.remaining--
    dispatchSession(db, { ...ticket, status: 'running' }, verifier, 'verifier')
    return
  }

  // All verifiers dispatched — check if all done
  const allVerifiersDone = verifierSessions.length >= verifierIds.length &&
    verifierSessions.every(s => s.status !== 'running')

  if (!allVerifiersDone) return

  // Read verdicts for this round
  const roundVerdicts = verifierSessions
    .map(s => database.verdictBySession(db, s.id))
    .filter((v): v is NonNullable<typeof v> => v != null)

  if (roundVerdicts.length < verifierIds.length) {
    // Not all verdicts in (some verifiers may have been cancelled)
    // Treat missing verdicts as fails
  }

  const allPass = roundVerdicts.length > 0 && roundVerdicts.every(v => v.pass)

  if (allPass) {
    transition(db, ticket.id, 'waiting', 'finished', 'reconciler')
    const notes = roundVerdicts.map(v => {
      const a = agents.find(x => x.id === v.agent_id)
      return a?.name ?? v.agent_id
    })
    database.commentInsert(db, {
      ticket_id: ticket.id, session_id: null,
      author: 'system', body: `Verified by: ${notes.join(', ')}.`,
      created_at: now(),
    })
  } else {
    // Any fail — cycle back to waiting for next producer round
    transition(db, ticket.id, 'waiting', 'waiting', 'reconciler', { reason: 'verdict_fail' })
    // Dispatch new producer if slot available
    if (slots.remaining > 0) {
      if (transition(db, ticket.id, 'waiting', 'running', 'reconciler', { reason: 'retry' })) {
        slots.remaining--
        dispatchSession(db, { ...ticket, status: 'running' }, agent, 'producer')
      }
    }
  }
}

// ── Sweep ──

export async function reconcilerTick(db: Db): Promise<void> {
  for (const proj of database.projectsActive(db)) {
    const allAgents = agentList(db, { accountId: proj.owner_id })

    const running = ticketList(db, { projectId: proj.id, status: 'running' })
    const slots = { remaining: proj.max_agents - running.length }

    // Gather non-terminal tickets, sort by last event time ASC (FIFO)
    const nonTerminal = [
      ...ticketList(db, { projectId: proj.id, status: 'running' }),
      ...ticketList(db, { projectId: proj.id, status: 'waiting' }),
      ...ticketList(db, { projectId: proj.id, status: 'created' }),
    ].sort((a, b) => lastEventTime(db, a.id).localeCompare(lastEventTime(db, b.id)))

    for (const ticket of nonTerminal) {
      switch (ticket.status) {
        case 'created': evaluateCreated(db, ticket, allAgents, slots); break
        case 'running': evaluateRunning(db, ticket); break
        case 'waiting': evaluateWaiting(db, ticket, allAgents, slots); break
      }
    }
  }
}

// ── Lifecycle ──

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
