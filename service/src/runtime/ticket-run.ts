// Entry point for a ticket run. Composes the session stacks, runs the
// producer, then each verifier, then settles the ticket.
//
// The difference between a producer and a verifier session is which
// middleware stack wraps the agent loop. There is no recursion and no
// asVerifier flag — the two stacks are defined inline below, and the
// orchestrator at the bottom of the file owns the cross-session glue.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket, Session } from '../tables.js'
import { ticketResolve } from '../domain/tickets.js'
import { now } from '../util.js'

import { use, type SessionContext, type SessionStep } from './compose.js'

import { withCrashSafe }            from './middleware/crash-safe.js'
import { withSessionBookkeeping }   from './middleware/session-bookkeeping.js'
import { withActivityBackfill }     from './middleware/activity-backfill.js'
import { withTicketFailOnCrash }    from './middleware/ticket-fail-on-crash.js'
import { withSyntheticFailVerdict } from './middleware/synthetic-fail-verdict.js'
import { withScratchWorkspace }     from './middleware/scratch-workspace.js'
import { withSystemPrompt }         from './middleware/system-prompt.js'
import { withOpeningPrompt }        from './middleware/opening-prompt.js'
import { withCooperativeCancel }    from './middleware/cooperative-cancel.js'

// ── helpers ───────────────────────────────────────────────────────────────

interface Verdict { agentName: string; pass: boolean; reason: string }

function makeContext(
  db: Db, config: Config, session: Session, ticket: Ticket, agent: AgentDef,
): SessionContext {
  return {
    db, config, session, ticket, agent,
    systemPrompt: '', userPrompt: '', workDir: '',
    shouldStop:   () => false,
    startedAt:    Date.now(),
  }
}

function parseVerifiers(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch { return [] }
}

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function summarizeProducer(ctx: SessionContext): string {
  const r = ctx.result
  if (!r) return ''
  const durationMs = Date.now() - ctx.startedAt
  const parts: string[] = []
  if (r.toolCalls > 0)              parts.push(`${r.toolCalls} tool${r.toolCalls === 1 ? '' : 's'}`)
  if (r.tokensIn + r.tokensOut > 0) parts.push(`${fmtTokensShort(r.tokensIn)} in · ${fmtTokensShort(r.tokensOut)} out`)
  if (r.costUsd > 0)                parts.push(`$${r.costUsd.toFixed(4)}`)
  if (durationMs > 0)               parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

function readVerdict(db: Db, sessionId: string, agentName: string): Verdict {
  const row = database.verdictBySession(db, sessionId)
  if (row) return { agentName, pass: row.pass, reason: row.reason }
  // Defensive: withSyntheticFailVerdict should have written one.
  return { agentName, pass: false, reason: 'verifier ended without reporting a verdict' }
}

function settleTicket(db: Db, ticket: Ticket, producer: AgentDef, verdicts: Verdict[], summary: string): void {
  if (verdicts.every(v => v.pass)) {
    const suffix = verdicts.length > 0
      ? `\n\nVerified by: ${verdicts.map(v => v.agentName).join(', ')}.`
      : ''
    ticketResolve(db, ticket.id, 'finished', {
      agentName: producer.name,
      notes:     summary ? `${summary}${suffix}` : suffix.trimStart(),
    })
    return
  }
  // Any fail → reopen. Next round's producer reads verdict reasons from
  // its system prompt (assembleSystemPrompt pulls them live).
  database.ticketUpdate(db, ticket.id, {
    status: 'opened', outcome: null, claimed_at: null, updated_at: now(),
  })
}

// ── atomic step: dispatch to the right SDK loop ───────────────────────────

const invokeAgent: SessionStep = async (ctx) => {
  const conn = database.connectionGet(ctx.db, ctx.agent.connection_id)
  const loop = conn?.kind === 'anthropic-subscription'
    ? (await import('./loop/anthropic.js')).runAnthropicLoop
    : (await import('./loop/vercel.js'   )).runVercelLoop
  ctx.result = await loop(ctx)
  return ctx
}

// ── stacks: producer and verifier differ by three middlewares ─────────────

const runProducer = use(
  withCrashSafe,
  withSessionBookkeeping,
  withActivityBackfill,
  withTicketFailOnCrash,
  withScratchWorkspace,
  withSystemPrompt('producer'),
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)

const runVerifier = use(
  withCrashSafe,
  withSessionBookkeeping,
  withActivityBackfill,
  withSyntheticFailVerdict,
  withScratchWorkspace,
  withSystemPrompt('verifier'),
  withOpeningPrompt,
  withCooperativeCancel,
)(invokeAgent)

// ── orchestrator ──────────────────────────────────────────────────────────

export async function runAgentSession(
  db: Db, config: Config, sessionId: string, producer: AgentDef, ticket: Ticket,
): Promise<void> {
  const producerRow = database.sessionGet(db, sessionId)
  if (!producerRow) throw new Error(`session ${sessionId} not found`)

  const producerCtx = await runProducer(makeContext(db, config, producerRow, ticket, producer))
  if (!producerCtx.result) return                // producer crashed; ticket already resolved 'failed'
  if (producerCtx.result.cancelled) return       // founder cancelled; respect the halt

  const verdicts: Verdict[] = []
  for (const vid of parseVerifiers(producer.verifiers)) {
    const verifier = database.agentGet(db, vid)
    if (!verifier) {
      verdicts.push({ agentName: vid, pass: false, reason: `verifier '${vid}' not found` })
      continue
    }
    const verifierRow = database.sessionInsert(db, {
      ticket_id: ticket.id, agent_id: verifier.id,
      status: 'running', started_at: now(),
    })
    const verifierCtx = await runVerifier(makeContext(db, config, verifierRow, ticket, verifier))
    if (verifierCtx.result?.cancelled) return    // founder cancelled mid-dance; stop
    verdicts.push(readVerdict(db, verifierRow.id, verifier.name))
  }

  settleTicket(db, ticket, producer, verdicts, summarizeProducer(producerCtx))
}

