// Verifier dance — runs after a producer's session ends with finished
// intent. For each verifier on the producer's agent, spawn a session on the
// SAME ticket, let the verifier review (payload + comments), and read back
// a verdict. All pass → ticketResolve(finished). Any fail → ticketReopen
// + comments. The ticket's slot stays held throughout (the producer
// session is done; the verifier sessions hold the slot while running).

import { sql } from 'drizzle-orm'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { now } from '../util.js'
import { ticketResolve, commentCreate } from '../domain/tickets.js'
import { ulid } from 'ulid'

interface Verdict {
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

// Read the latest verdict activity for a verifier session. If absent,
// treat as failure ("verifier didn't return a verdict") — fail-closed.
function readVerdict(db: Db, sessionId: string, agentName: string): Verdict {
  const row = db.get<{ payload: string }>(sql`
    SELECT payload FROM activity
    WHERE session_id = ${sessionId} AND kind = 'verdict'
    ORDER BY created_at DESC LIMIT 1
  `)
  if (!row) {
    return { agent_name: agentName, pass: false, reason: 'verifier ended without reporting a verdict' }
  }
  try {
    const p = JSON.parse(row.payload) as { pass?: boolean; reason?: string }
    return { agent_name: agentName, pass: !!p.pass, reason: p.reason ?? '' }
  } catch {
    return { agent_name: agentName, pass: false, reason: 'verdict payload malformed' }
  }
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

  const verdicts: Verdict[] = []
  // Sequential within a ticket so the slot doesn't fan out and starve
  // other tickets. Verifier inference is cheap relative to producer work.
  for (const vid of verifierIds) {
    const verifier = database.agentGet(db, vid)
    if (!verifier) {
      verdicts.push({ agent_name: vid, pass: false, reason: `verifier '${vid}' not found` })
      continue
    }
    const sessionId = ulid()
    database.sessionInsert(db, {
      ticket_id: ticket.id, agent_id: verifier.id,
      status: 'running', started_at: now(),
    })
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
      verdicts.push({ agent_name: verifier.name, pass: false, reason: `verifier crashed: ${msg}` })
      continue
    }
    verdicts.push(readVerdict(db, sessionId, verifier.name))
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

  // Any verifier rejected → reopen, leave the producer's agent_id intact,
  // post each failing verdict as a comment so the producer can see what to fix.
  for (const v of verdicts) {
    if (v.pass) continue
    commentCreate(db, ticket.id, {
      author: v.agent_name,
      body:   `[VERIFIER FAIL] ${v.reason}`,
    })
  }
  // Reopen — ticket goes back to opened, scheduler will redispatch.
  database.ticketUpdate(db, ticket.id, {
    status: 'opened', outcome: null, claimed_at: null, updated_at: now(),
  })
}

// Suppress unused import noise
void schema
