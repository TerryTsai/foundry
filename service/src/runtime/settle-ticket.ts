// Decide the ticket's terminal state from the verdict set. No verifiers
// or all pass → resolved finished. Any fail → reopen for the next round.
// Verdict rows are already persisted by the verifiers (or synthesized on
// crash / silence); the next producer's system prompt picks them up via
// assembleSystemPrompt.

import * as database from '../database.js'
import type { Db } from '../database.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { ticketResolve } from '../domain/tickets.js'
import { now } from '../util.js'
import type { LoopResult } from './compose.js'

export interface Verdict { agentName: string; pass: boolean; reason: string }

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function summarizeProducer(r: LoopResult, durationMs: number): string {
  const parts: string[] = []
  if (r.toolCalls > 0)              parts.push(`${r.toolCalls} tool${r.toolCalls === 1 ? '' : 's'}`)
  if (r.tokensIn + r.tokensOut > 0) parts.push(`${fmtTokensShort(r.tokensIn)} in · ${fmtTokensShort(r.tokensOut)} out`)
  if (r.costUsd > 0)                parts.push(`$${r.costUsd.toFixed(4)}`)
  if (durationMs > 0)               parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

export function readVerdict(db: Db, sessionId: string, agentName: string): Verdict {
  const row = database.verdictBySession(db, sessionId)
  if (row) return { agentName, pass: row.pass, reason: row.reason }
  // Defensive: synthetic-fail-verdict middleware should have written one.
  return { agentName, pass: false, reason: 'verifier ended without reporting a verdict' }
}

export function settleTicket(
  db: Db, ticket: Ticket, producer: AgentDef,
  verdicts: Verdict[], producerSummary: string,
): void {
  const allPass = verdicts.every(v => v.pass)
  if (allPass) {
    const suffix = verdicts.length > 0
      ? `\n\nVerified by: ${verdicts.map(v => v.agentName).join(', ')}.`
      : ''
    ticketResolve(db, ticket.id, 'finished', {
      agentName: producer.name,
      notes:     producerSummary ? `${producerSummary}${suffix}` : suffix.trimStart(),
    })
    return
  }
  // Any fail → reopen. Next round's producer reads the verdict reasons
  // from its system prompt.
  database.ticketUpdate(db, ticket.id, {
    status: 'opened', outcome: null, claimed_at: null, updated_at: now(),
  })
}
