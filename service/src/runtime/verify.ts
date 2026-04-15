// Verifier dance — runs after a producer's session ends with finished
// intent. For each verifier on the producer's agent, spawn a session on the
// SAME ticket, let the verifier review (payload + comments), and read back
// a verdict. All pass → ticketResolve(finished). Any fail → ticketReopen
// + comments. The ticket's slot stays held throughout (the producer
// session is done; the verifier sessions hold the slot while running).

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { now } from '../util.js'
import { ticketResolve } from '../domain/tickets.js'

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

// Read the verdict a verifier session wrote via the verdictReport tool.
// Absent → persist a fail-closed synthetic so the reason survives for the
// next round's producer prompt. A silent verifier is treated as having
// failed to review; never as implicit approval.
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
    // sessionInsert mints the id; must use the returned row's id. Prior
    // bug: we generated a ulid locally and passed it to the runner, but
    // sessionInsert ignored our id and used its own, so every write the
    // runner made (activity, execution, verdict) FK-failed against a
    // non-existent session row.
    const sess = database.sessionInsert(db, {
      ticket_id: ticket.id, agent_id: verifier.id,
      status: 'running', started_at: now(),
    })
    const sessionId = sess.id
    // Defer-import the runner to avoid a circular import (runner imports
    // this module). Routing by connection kind mirrors runner-ai's
    // top-level dispatch.
    const conn = database.connectionGet(db, verifier.connection_id)
    const isSubscription = conn?.kind === 'anthropic-subscription'
    const mod = isSubscription
      ? await import('./runner-claude.js')
      : await import('./runner-ai.js')
    const runFn = isSubscription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (mod as any).runAgentSessionViaClaude
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (mod as any).runAgentSessionViaAi
    try {
      await runFn(db, config, sessionId, verifier, ticket)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Persist the crash reason as a fail verdict so the next round's
      // producer sees it in its system prompt, same as any normal fail.
      const reason = `verifier crashed: ${msg}`
      database.verdictInsert(db, {
        ticket_id: ticket.id, session_id: sessionId, agent_id: verifier.id,
        pass: false, reason, created_at: now(),
      })
      verdicts.push({ agent_name: verifier.name, pass: false, reason })
      continue
    }
    verdicts.push(readVerdict(db, ticket.id, sessionId, verifier.id, verifier.name))
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
  // assembleSystemPrompt. No comments written — verdicts are the record.
  database.ticketUpdate(db, ticket.id, {
    status: 'opened', outcome: null, claimed_at: null, updated_at: now(),
  })
}
