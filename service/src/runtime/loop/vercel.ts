// Vercel AI SDK loop — the non-subscription backend. One generateText
// call per step; each step's ContentPart[] is projected into activity
// rows. Tokens ride on the first activity of the step.

import { generateText, stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai'
import { ulid } from 'ulid'

import { type Db } from '../../database.js'
import * as database from '../../database.js'
import { parseConn, asText } from '../../mcp/shared.js'
import { now } from '../../util.js'

import { resolveModelWithDefaults } from './model.js'
import type { SessionContext, LoopResult } from '../compose.js'
import type { ToolDef } from '../../mcp/registry.js'

import * as foundryServer from '../../mcp/foundry.js'
import * as githubServer  from '../../mcp/github.js'
import * as sandboxServer from '../../mcp/sandbox.js'
import * as browserServer from '../../mcp/browser.js'
import { byConnectionKind } from '../../mcp/registry.js'

type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args?: unknown; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; output?: unknown }
  | { type: string; [k: string]: unknown }


function toAiTools(defs: ToolDef[], ctx: unknown, prefix?: string): ToolSet {
  const out: ToolSet = {}
  for (const t of defs) {
    const key = prefix ? `${prefix}-${t.name}` : t.name
    out[key] = tool({ description: t.description, inputSchema: t.schema as any, execute: (a: any) => t.handler(ctx, a) })
  }
  return out
}

function buildTools(ctx: SessionContext): ToolSet {
  const { db, config, workDir } = ctx
  const sessionId  = ctx.session.id
  const agentDef   = ctx.agent
  const ticketData = ctx.ticket
  const result: ToolSet = {
    ...toAiTools(foundryServer.tools, { db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name }),
    ...toAiTools(githubServer.tools,  { db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name }),
    ...toAiTools(sandboxServer.tools, { db, config, sessionId, workspace: workDir }),
    ...toAiTools(browserServer.tools, { db, config, sessionId, workspace: workDir }),
  }
  const conns = database.connectionByAccount(db, agentDef.account_id)
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    if (!mod) continue
    const { secrets, connConfig } = parseConn(conn)
    const prefix = `${conn.kind}-${conn.name}`
    Object.assign(result, toAiTools(mod.tools, { db, config, sessionId, workspace: workDir, secrets, connConfig, connectionName: conn.name }, prefix))
  }
  return result
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

export async function runVercelLoop(ctx: SessionContext): Promise<LoopResult> {
  const { db, systemPrompt, userPrompt, shouldStop } = ctx
  const sessionId = ctx.session.id
  const agentDef  = ctx.agent
  const model     = resolveModelWithDefaults(db, agentDef)
  const tools     = buildTools(ctx)
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
