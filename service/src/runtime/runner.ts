// Orchestrate a full ticket run: one producer session, then a flat
// sequence of verifier sessions, then settle the ticket.
//
// Reads like sentences: run the producer, run each verifier, settle.
// No recursion, no asVerifier flag — the difference between a producer
// and verifier is which middleware stack wraps the agent loop (see
// session-stacks.ts). This file owns the cross-session glue only.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket, Session } from '../tables.js'
import { now } from '../util.js'

import type { SessionContext, SessionStep } from './compose.js'
import { producerSession, verifierSession } from './session-stacks.js'
import { settleTicket, summarizeProducer, readVerdict, type Verdict } from './settle-ticket.js'

function openContext(
  db: Db, config: Config, session: Session, agent: AgentDef, ticket: Ticket,
): SessionContext {
  return {
    db, config, session, agent, ticket,
    systemPrompt: '',
    userPrompt:   '',
    workDir:      '',
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

async function runOneSession(
  stack: SessionStep, db: Db, config: Config,
  session: Session, agent: AgentDef, ticket: Ticket,
): Promise<SessionContext> {
  const ctx = openContext(db, config, session, agent, ticket)
  await stack(ctx)
  return ctx
}

export async function runAgentSession(
  db: Db, config: Config, sessionId: string, producer: AgentDef, ticket: Ticket,
): Promise<void> {
  const producerRow = database.sessionGet(db, sessionId)
  if (!producerRow) throw new Error(`session ${sessionId} not found`)

  // Producer. If it throws, the ticket has already been resolved 'failed'
  // by withTicketFailOnCrash; skip verifiers entirely.
  let producerCtx: SessionContext
  try {
    producerCtx = await runOneSession(producerSession, db, config, producerRow, producer, ticket)
  } catch { return }

  // Verifiers. Run each; on crash, the synthetic-fail-verdict middleware
  // has already written a fail row, so readVerdict still returns a
  // verdict. The orchestrator owns the "continue after crash" policy so
  // one bad verifier doesn't abort the rest of the dance.
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
    try { await runOneSession(verifierSession, db, config, verifierRow, verifier, ticket) }
    catch { /* verdict already synthesized; fall through to readVerdict */ }
    verdicts.push(readVerdict(db, verifierRow.id, verifier.name))
  }

  const durationMs = Date.now() - producerCtx.startedAt
  const summary    = producerCtx.result ? summarizeProducer(producerCtx.result, durationMs) : ''
  settleTicket(db, ticket, producer, verdicts, summary)
}
