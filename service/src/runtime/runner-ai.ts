import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import { ulid } from 'ulid'
import { sql } from 'drizzle-orm'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef } from '../tables.js'
import { ticketComplete, ticketFail } from '../domain/tickets.js'
import { now } from '../util.js'

import { eq } from 'drizzle-orm'

import { workspaceEmpty, workspaceDestroy } from '../mcp/github.js'
import { resolveModelWithDefaults } from './model.js'
import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'
import * as schema from '../tables.js'
import { buildConnectionAiTools, connectionTools } from '../mcp/connection.js'

type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

// ════════════════════════════════════════════════════════════════════════════
// DISPATCH
// ════════════════════════════════════════════════════════════════════════════
// Two runner paths share one entry point. The connection's `kind` picks:
//
//   'anthropic-subscription' → sdk-runner.ts (Claude Agent SDK, OAuth,
//                              BetaMessage content-block stream)
//   anything else            → this file (Vercel ai SDK, API-key-based
//                              providers: anthropic, openai, and future
//                              additions via model.ts factories)
//
// Both paths write the same `activity` rows so the UI renders the session
// identically regardless of how it was run.

export async function runAgentSession(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const conn = database.connectionGet(db, agentDef.connection_id)
  if (conn?.kind === 'anthropic-subscription') {
    const { runAgentSessionViaClaude } = await import('./runner-claude.js')
    return runAgentSessionViaClaude(db, config, sessionId, agentDef, ticketData)
  }
  return runAgentSessionViaAi(db, config, sessionId, agentDef, ticketData)
}

// ════════════════════════════════════════════════════════════════════════════
// PROMPT ASSEMBLY
// ════════════════════════════════════════════════════════════════════════════
// Same shape as sdk-runner's: every descriptive layer concatenated into the
// system prompt, with a minimal trigger as the user-turn.

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
  return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined
}

function triggerPrompt(ticket: Ticket): string {
  const title = ticket.title.trim() || '(untitled)'
  return `Begin work on the ticket above: **${title}**. Proceed autonomously.`
}

// ════════════════════════════════════════════════════════════════════════════
// SESSION SUMMARY
// ════════════════════════════════════════════════════════════════════════════

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function summarizeSession(toolCalls: number, tokensIn: number, tokensOut: number, costUsd: number, durationMs: number): string {
  const parts: string[] = []
  if (toolCalls > 0)            parts.push(`${toolCalls} tool${toolCalls === 1 ? '' : 's'}`)
  if (tokensIn + tokensOut > 0) parts.push(`${fmtTokensShort(tokensIn)} in · ${fmtTokensShort(tokensOut)} out`)
  if (costUsd > 0)              parts.push(`$${costUsd.toFixed(4)}`)
  if (durationMs > 0)           parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY PROJECTION
// ════════════════════════════════════════════════════════════════════════════
// Walk a StepResult's content array (the AI SDK's ContentPart[] — the
// structural analog of BetaMessage.content) and emit one activity row per
// block. Tokens ride on the first activity of the step.

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args?: unknown; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; output?: unknown }
  | { type: string; [k: string]: unknown }

function contentPartsOf(result: StepResult): ContentPart[] {
  const c = (result as unknown as { content?: ContentPart[] }).content
  return Array.isArray(c) ? c : []
}

function writeStepActivities(db: Db, sessionId: string, turnId: string, result: StepResult): number {
  const parts = contentPartsOf(result)
  const { inputTokens, outputTokens } = result.usage ?? {}
  let toolCalls = 0
  parts.forEach((b, idx) => {
    let kind: 'said' | 'thought' | 'tool_call' | 'reconcile' = 'said'
    let payload: unknown = b
    let tool_use_id: string | null = null
    if (b.type === 'text' && typeof b.text === 'string') {
      kind = 'said'
      payload = { text: b.text }
    } else if (b.type === 'reasoning' && typeof b.text === 'string') {
      kind = 'thought'
      payload = { text: b.text, char_count: b.text.length, signature: b.signature ?? null }
    } else if (b.type === 'tool-call' && typeof b.toolCallId === 'string') {
      kind = 'tool_call'
      payload = { name: b.toolName, input: b.args ?? b.input ?? {} }
      tool_use_id = b.toolCallId
      toolCalls++
    } else if (b.type === 'tool-result') {
      // tool-result is the sandbox response. We already have the execution
      // row via runCommand; no need for its own activity — the correlated
      // tool_call activity surfaces the outcome. Skip.
      return
    }
    database.activityInsert(db, {
      session_id:   sessionId,
      turn_id:      turnId,
      kind,
      order_index:  idx,
      payload:      JSON.stringify(payload),
      tool_use_id,
      execution_id: null,            // backfilled at session close
      tokens_in:    idx === 0 ? (inputTokens  ?? null) : null,
      tokens:       idx === 0 ? (outputTokens ?? null) : null,
      created_at:   now(),
    })
  })
  return toolCalls
}

function backfillExecutionIds(db: Db, sessionId: string) {
  db.run(sql`
    UPDATE activity
       SET execution_id = (SELECT id FROM execution WHERE execution.tool_use_id = activity.tool_use_id)
     WHERE session_id = ${sessionId} AND kind = 'tool_call' AND execution_id IS NULL AND tool_use_id IS NOT NULL
  `)
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════════════════════

async function runLoop(db: Db, args: {
  model: ReturnType<typeof resolveModelWithDefaults>, system: string, tools: ToolSet, agentDef: AgentDef,
  sessionId: string, initialMessage: string,
}): Promise<{ finishReason: string | null; tokensIn: number; tokensOut: number; toolCalls: number }> {
  const { model, system, tools, agentDef, sessionId, initialMessage } = args
  const messages: ModelMessage[] = [{ role: 'user', content: initialMessage }]
  let finishReason: string | null = null
  let tokensIn  = 0
  let tokensOut = 0
  let toolCalls = 0

  for (let step = 0; step < agentDef.max_steps; step++) {
    const result = await generateText({ model, system, messages, tools, stopWhen: stepCountIs(1) })
    // One "turn" per step. ULID gives us a stable key to group that step's
    // activity rows, same role BetaMessage.id plays for the SDK runner.
    const turnId = ulid()
    toolCalls += writeStepActivities(db, sessionId, turnId, result)
    tokensIn  += result.usage?.inputTokens  ?? 0
    tokensOut += result.usage?.outputTokens ?? 0
    messages.push(...result.response.messages)
    finishReason = result.finishReason ?? null
    if (finishReason === 'stop') break
  }
  return { finishReason, tokensIn, tokensOut, toolCalls }
}

// ════════════════════════════════════════════════════════════════════════════
// AI SDK PATH
// ════════════════════════════════════════════════════════════════════════════

async function runAgentSessionViaAi(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  const workDir = await workspaceEmpty()

  try {
    const systemPrompt = assembleSystemPrompt(db, ticketData, agentDef)
    if (systemPrompt) database.sessionUpdate(db, sessionId, { system_prompt: systemPrompt })

    // Record the founder's trigger as a 'prompt' activity.
    const userPrompt = triggerPrompt(ticketData)
    database.activityInsert(db, {
      session_id:  sessionId,
      turn_id:     null,
      kind:        'prompt',
      order_index: 0,
      payload:     JSON.stringify({ text: userPrompt }),
      tool_use_id: null, execution_id: null, tokens_in: null, tokens: null,
      created_at:  now(),
    })

    // Tool surface — all four MCP servers as flat ai-SDK tool records.
    const tools: ToolSet = {
      ...foundryServer.buildAi({ db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name }),
      ...githubServer.buildAi({ db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name }),
      ...sandboxServer.buildAi({ db, config, sessionId, workspace: workDir }),
      ...browserServer.buildAi({ db, config, sessionId, workspace: workDir }),
    }
    // Connection-contributed tools. Flat-namespaced as <kind>-<name>-<tool>
    // in the ai-SDK ToolSet because there's no server concept here.
    const accountConns = database.connectionAll(db, [eq(schema.connection.account_id, agentDef.account_id)])
    for (const conn of accountConns) {
      if (!connectionTools(conn.kind).length) continue
      Object.assign(tools, buildConnectionAiTools(
        { db, config, sessionId, workspace: workDir }, conn, null,
      ))
    }
    const model = resolveModelWithDefaults(db, agentDef)
    const { finishReason, tokensIn, tokensOut, toolCalls } = await runLoop(db, {
      model, system: systemPrompt ?? '', tools, agentDef, sessionId, initialMessage: userPrompt,
    })

    backfillExecutionIds(db, sessionId)

    const durationMs = Date.now() - startTime
    const summary = summarizeSession(toolCalls, tokensIn, tokensOut, 0, durationMs)
    ticketComplete(db, ticketData.id, { agentName: agentDef.name, sessionId, notes: summary })
    database.sessionUpdate(db, sessionId, {
      status: 'done', ended_at: now(), duration_ms: durationMs, finish_reason: finishReason,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try { backfillExecutionIds(db, sessionId) } catch {}
    try { ticketFail(db, ticketData.id, { notes: msg, agentName: agentDef.name, sessionId }) } catch {}
    database.sessionUpdate(db, sessionId, {
      status: 'failed', error: msg, ended_at: now(), duration_ms: Date.now() - startTime,
    })
  } finally {
    await workspaceDestroy(workDir)
  }
}
