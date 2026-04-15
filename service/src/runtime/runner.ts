// Unified agent-session runner.
//
// One entry point drives both SDK paths. The session lifecycle — workspace,
// system prompt, tool surface, activity lifecycle, session-row updates,
// cancel handling, verifier dance — lives here. The SDK-specific turn
// loops (Vercel AI SDK or Claude Agent SDK) are thin modules behind a
// uniform contract; they emit activity rows into the same shape.
//
// Session kinds:
//   producer  — runs agent, then calls runVerifiers on success
//   verifier  — runs agent, does NOT call runVerifiers (avoids recursion
//               when a verifier has no verifiers of its own)
//
// The `asVerifier` flag is the only behavioral difference between the two.

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Agent as AgentDef, Ticket } from '../tables.js'
import { ticketResolve } from '../domain/tickets.js'
import { now } from '../util.js'

import { workspaceEmpty, workspaceDestroy } from '../mcp/github.js'

// ── Shared helpers ─────────────────────────────────────────────────────────

export interface TurnsResult {
  finishReason: string | null
  tokensIn:     number
  tokensOut:    number
  toolCalls:    number
  costUsd:      number
  cancelled:    boolean
}

export interface TurnsContext {
  db:           Db
  config:       Config
  sessionId:    string
  ticketData:   Ticket
  agentDef:     AgentDef
  systemPrompt: string
  userPrompt:   string
  workDir:      string
  shouldStop:   () => boolean
}

// Cooperative cancel: poll ticket + session state at step/message
// boundaries. Break out when the ticket leaves `claimed` (founder cancel,
// verifier-dance reopen) or the session leaves `running` (external kill).
function makeShouldStop(db: Db, sessionId: string, ticketId: string): () => boolean {
  return () => {
    const t = database.ticketGet(db, ticketId)
    if (!t || t.status !== 'claimed') return true
    const s = database.sessionGet(db, sessionId)
    if (!s || s.status !== 'running') return true
    return false
  }
}

// Concat every descriptive layer into the agent's system prompt. Stored on
// session.system_prompt so historical sessions remain reproducible even
// after the source layers change.
function assembleSystemPrompt(db: Db, ticket: Ticket, agent: AgentDef): string | undefined {
  const project = database.projectGet(db, ticket.project_id)
  const account = project ? database.accountGet(db, project.owner_id) : undefined

  const parts: string[] = []
  const push = (heading: string, body: string | null | undefined) => {
    if (body && body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`)
  }
  push('Founder',   account?.description)
  push('Project',   project?.description)
  push('Your role', agent.description)
  push('Ticket',    ticket.description)

  const comments = database.commentByTicket(db, ticket.id)
  if (comments.length > 0) {
    parts.push('## Comments\n\n' + comments.map(c => `[${c.author}] ${c.body}`).join('\n\n'))
  }

  const verdicts = database.verdictByTicket(db, ticket.id)
  if (verdicts.length > 0) {
    const lines = verdicts.map(v => {
      const name = database.agentGet(db, v.agent_id)?.name ?? v.agent_id
      const tag  = v.pass ? 'PASS' : 'FAIL'
      return `[${name}] ${tag} — ${v.reason}`
    })
    parts.push('## Prior verdicts on this ticket\n\n' + lines.join('\n\n') + '\n\nAddress any FAIL reasons above before reporting finished again.')
  }
  return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined
}

function triggerPrompt(ticket: Ticket): string {
  const title = ticket.title.trim() || '(untitled)'
  return `Begin work on the ticket above: **${title}**. Proceed autonomously.`
}

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function summarizeSession(r: TurnsResult, durationMs: number): string {
  const parts: string[] = []
  if (r.toolCalls > 0)                parts.push(`${r.toolCalls} tool${r.toolCalls === 1 ? '' : 's'}`)
  if (r.tokensIn + r.tokensOut > 0)   parts.push(`${fmtTokensShort(r.tokensIn)} in · ${fmtTokensShort(r.tokensOut)} out`)
  if (r.costUsd > 0)                  parts.push(`$${r.costUsd.toFixed(4)}`)
  if (durationMs > 0)                 parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

// Record the founder's trigger as a 'prompt' activity at session start.
function writePromptActivity(db: Db, sessionId: string, text: string): void {
  database.activityInsert(db, {
    session_id:   sessionId,
    turn_id:      null,
    kind:         'prompt',
    order_index:  0,
    payload:      JSON.stringify({ text }),
    tool_use_id:  null,
    execution_id: null,
    tokens_in:    null,
    tokens:       null,
    created_at:   now(),
  })
}

// ── Entry point ───────────────────────────────────────────────────────────

export interface RunOptions {
  // Verifier sessions must not trigger their own verifier dance — otherwise
  // a verifier with no verifiers resolves the ticket out from under the
  // outer producer's dance, and the producer's session gets marked failed.
  asVerifier?: boolean
}

export async function runAgentSession(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
  opts: RunOptions = {},
): Promise<void> {
  const startTime = Date.now()
  const workDir   = await workspaceEmpty()
  const conn      = database.connectionGet(db, agentDef.connection_id)
  const isSubscription = conn?.kind === 'anthropic-subscription'

  try {
    const systemPrompt = assembleSystemPrompt(db, ticketData, agentDef) ?? ''
    if (systemPrompt) database.sessionUpdate(db, sessionId, { system_prompt: systemPrompt })

    const userPrompt = triggerPrompt(ticketData)
    writePromptActivity(db, sessionId, userPrompt)

    const turnsCtx: TurnsContext = {
      db, config, sessionId, ticketData, agentDef,
      systemPrompt, userPrompt, workDir,
      shouldStop: makeShouldStop(db, sessionId, ticketData.id),
    }

    const result = isSubscription
      ? await (await import('./turns-claude.js')).runTurnsViaClaude(turnsCtx)
      : await (await import('./turns-ai.js')).runTurnsViaAi(turnsCtx)

    database.backfillActivityExecutionIds(db, sessionId)

    const durationMs = Date.now() - startTime

    if (result.cancelled) {
      database.sessionUpdate(db, sessionId, {
        status: 'cancelled', ended_at: now(), duration_ms: durationMs, finish_reason: 'cancelled',
        cost_usd: result.costUsd,
      })
      return
    }

    database.sessionUpdate(db, sessionId, {
      status:        'finished',
      ended_at:      now(),
      duration_ms:   durationMs,
      finish_reason: result.finishReason,
      cost_usd:      result.costUsd,
    })

    // Only the producer drives the verifier dance. Verifier sessions exit
    // here — the outer producer's runVerifiers will read their verdict.
    if (opts.asVerifier) return

    const summary = summarizeSession(result, durationMs)
    const { runVerifiers } = await import('./verify.js')
    await runVerifiers(db, config, ticketData, agentDef, { producerSummary: summary })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try { database.backfillActivityExecutionIds(db, sessionId) } catch {}
    // Only the producer owns the ticket's terminal state. Verifier sessions
    // record their own session.status='failed' but must not flip the
    // ticket — the outer producer's verify dance handles that via a fail
    // verdict insert.
    if (!opts.asVerifier) {
      try { ticketResolve(db, ticketData.id, 'failed', { notes: msg, agentName: agentDef.name, sessionId }) } catch {}
    }
    database.sessionUpdate(db, sessionId, {
      status:      'failed',
      error:       msg,
      ended_at:    now(),
      duration_ms: Date.now() - startTime,
    })
  } finally {
    await workspaceDestroy(workDir)
  }
}
