// Verifier dance — runs after a producer's session ends. For each verifier
// on the producer's agent, spawn a session on the SAME ticket, run it
// as a verifier (no recursive verify dance), and read back a verdict row.
// All pass → ticketResolve(finished). Any fail or crash or silence →
// ticketUpdate back to opened, and the next round's producer picks up
// the verdict reasons from its system prompt.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { now } from '../util.js'
import { ticketResolve } from '../domain/tickets.js'
import { runAgentSession } from './runner.js'

interface VerdictOutcome {
  agent_name: string
  pass:       boolean
  reason:     string
}

function parseVerifiers(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

// Read the verdict the verifier wrote via verdictReport. Absent →
// persist a fail-closed synthetic so the reason survives for the next
// round's producer prompt. Silent verifier = failed review, never
// implicit approval.
function readVerdict(db: Db, ticketId: string, sessionId: string, agentId: string, agentName: string): VerdictOutcome {
  const row = database.verdictBySession(db, sessionId)
  if (row) return { agent_name: agentName, pass: row.pass, reason: row.reason }
  const reason = 'verifier ended without reporting a verdict'
  database.verdictInsert(db, {
    ticket_id: ticketId, session_id: sessionId, agent_id: agentId,
    pass: false, reason, created_at: now(),
  })
  return { agent_name: agentName, pass: false, reason }
}

export async function runVerifiers(
  db: Db, config: Config, ticket: Ticket, producer: AgentDef,
  opts: { producerSummary?: string } = {},
): Promise<void> {
  const verifierIds = parseVerifiers(producer.verifiers)
  if (verifierIds.length === 0) {
    // No verifiers configured — straight to finished.
    ticketResolve(db, ticket.id, 'finished', {
      agentName: producer.name, notes: opts.producerSummary,
    })
    return
  }

  const verdicts: VerdictOutcome[] = []
  // Sequential within a ticket so the slot doesn't fan out and starve
  // other tickets. Verifier inference is cheap relative to producer work.
  for (const vid of verifierIds) {
    const verifier = database.agentGet(db, vid)
    if (!verifier) {
      verdicts.push({ agent_name: vid, pass: false, reason: `verifier '${vid}' not found` })
      continue
    }
    // sessionInsert mints the id; must use the row's id, not a local one.
    const sess = database.sessionInsert(db, {
      ticket_id: ticket.id, agent_id: verifier.id,
      status: 'running', started_at: now(),
    })
    try {
      await runAgentSession(db, config, sess.id, verifier, ticket, { asVerifier: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const reason = `verifier crashed: ${msg}`
      database.verdictInsert(db, {
        ticket_id: ticket.id, session_id: sess.id, agent_id: verifier.id,
        pass: false, reason, created_at: now(),
      })
      verdicts.push({ agent_name: verifier.name, pass: false, reason })
      continue
    }
    verdicts.push(readVerdict(db, ticket.id, sess.id, verifier.id, verifier.name))
  }

  const allPass = verdicts.every(v => v.pass)
  if (allPass) {
    ticketResolve(db, ticket.id, 'finished', {
      agentName: producer.name,
      notes: opts.producerSummary
        ? `${opts.producerSummary}\n\nVerified by: ${verdicts.map(v => v.agent_name).join(', ')}.`
        : `Verified by: ${verdicts.map(v => v.agent_name).join(', ')}.`,
    })
    return
  }

  // Any verifier rejected → reopen. Verdicts are already persisted in the
  // verdict table; the next producer's system prompt pulls them in via
  // assembleSystemPrompt.
  database.ticketUpdate(db, ticket.id, {
    status: 'opened', outcome: null, claimed_at: null, updated_at: now(),
  })
}
