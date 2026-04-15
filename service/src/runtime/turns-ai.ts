// Vercel AI SDK turn loop. Called from runner.ts for any connection
// whose kind is NOT 'anthropic-subscription'. One generateText call per
// step; each step's ContentPart[] is projected into activity rows. Tokens
// ride on the first activity of the step.

import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Connection } from '../tables.js'
import { now } from '../util.js'

import { resolveModelWithDefaults } from './model.js'
import type { TurnsContext, TurnsResult } from './runner.js'

import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'
import { byConnectionKind } from '../mcp/registry.js'

type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args?: unknown; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; output?: unknown }
  | { type: string; [k: string]: unknown }

function parseConn(conn: Connection): { secrets: Record<string, string>; connConfig: Record<string, unknown> } {
  let secrets:    Record<string, string>  = {}
  let connConfig: Record<string, unknown> = {}
  try { secrets    = JSON.parse(conn.secrets) as Record<string, string>  } catch { /* malformed */ }
  try { connConfig = JSON.parse(conn.config)  as Record<string, unknown> } catch { /* malformed */ }
  return { secrets, connConfig }
}

function buildTools(ctx: TurnsContext): ToolSet {
  const { db, config, sessionId, workDir, agentDef, ticketData } = ctx
  const tools: ToolSet = {
    ...foundryServer.buildAi({ db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name }),
    ...githubServer .buildAi({ db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name }),
    ...sandboxServer.buildAi({ db, config, sessionId, workspace: workDir }),
    ...browserServer.buildAi({ db, config, sessionId, workspace: workDir }),
  }
  // Connection-backed tools. Flat namespace <kind>-<name>-<tool>; no
  // server concept in the AI SDK ToolSet, so everything merges in.
  const conns = database.connectionAll(db, [eq(schema.connection.account_id, agentDef.account_id)])
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    if (!mod) continue
    const { secrets, connConfig } = parseConn(conn)
    Object.assign(tools, mod.buildAi({
      db, config, sessionId, workspace: workDir,
      secrets, connConfig, connectionName: conn.name,
    }))
  }
  return tools
}

function contentPartsOf(result: StepResult): ContentPart[] {
  const c = (result as unknown as { content?: ContentPart[] }).content
  return Array.isArray(c) ? c : []
}

// Project a StepResult's content parts into activity rows. Returns the
// number of tool calls emitted in this step.
function writeStepActivities(db: Db, sessionId: string, turnId: string, result: StepResult): number {
  const parts = contentPartsOf(result)
  const { inputTokens, outputTokens } = result.usage ?? {}
  let toolCalls = 0
  parts.forEach((b, idx) => {
    let kind: 'said' | 'thought' | 'tool_call' = 'said'
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
      // tool-result mirrors the execution row; skip so we don't double-log.
      return
    }
    database.activityInsert(db, {
      session_id:   sessionId,
      turn_id:      turnId,
      kind,
      order_index:  idx,
      payload:      JSON.stringify(payload),
      tool_use_id,
      execution_id: null,
      tokens_in:    idx === 0 ? (inputTokens  ?? null) : null,
      tokens:       idx === 0 ? (outputTokens ?? null) : null,
      created_at:   now(),
    })
  })
  return toolCalls
}

export async function runTurnsViaAi(ctx: TurnsContext): Promise<TurnsResult> {
  const { db, sessionId, agentDef, systemPrompt, userPrompt, shouldStop } = ctx
  const model    = resolveModelWithDefaults(db, agentDef)
  const tools    = buildTools(ctx)
  const messages: ModelMessage[] = [{ role: 'user', content: userPrompt }]

  let finishReason: string | null = null
  let tokensIn   = 0
  let tokensOut  = 0
  let toolCalls  = 0
  let cancelled  = false

  for (let step = 0; step < agentDef.max_steps; step++) {
    if (shouldStop()) { cancelled = true; break }
    const result = await generateText({ model, system: systemPrompt, messages, tools, stopWhen: stepCountIs(1) })
    const turnId = ulid()
    toolCalls += writeStepActivities(db, sessionId, turnId, result)
    tokensIn  += result.usage?.inputTokens  ?? 0
    tokensOut += result.usage?.outputTokens ?? 0
    messages.push(...result.response.messages)
    finishReason = result.finishReason ?? null
    if (finishReason === 'stop') break
  }

  return { finishReason, tokensIn, tokensOut, toolCalls, costUsd: 0, cancelled }
}
