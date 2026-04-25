// Vercel AI SDK loop — the non-subscription backend. One generateText
// call per step; each step's ContentPart[] is projected into activity rows.

import { generateText, stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai'
import { ulid } from 'ulid'

import { type Db } from '@foundry/db'
import { now } from '@foundry/model'

import { resolveModelWithDefaults } from './model-factory.js'
import type {
  EngineDeps, SessionContext, LoopResult, ToolDef, ExecutionCreate,
  McpFoundryCtx, McpGithubCtx, McpSandboxCtx, McpConnCtx,
} from '../types.js'

// `ai`'s tool schema slot. The ai SDK pulls in its own zod typing that
// drifts vs the workspace zod version; the option type is the safe
// shared shape between them.
type AiToolOptions = Parameters<typeof tool>[0]
type AiToolInputSchema = AiToolOptions['inputSchema']

type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args?: unknown; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; output?: unknown }
  | { type: string; [k: string]: unknown }


function toAiTools<TCtx>(defs: ToolDef<TCtx>[], ctx: TCtx, prefix?: string): ToolSet {
  const out: ToolSet = {}
  for (const t of defs) {
    const key = prefix ? `${prefix}-${t.name}` : t.name
    out[key] = tool({
      description: t.description,
      inputSchema: t.schema as unknown as AiToolInputSchema,
      execute: (args: unknown) => t.handler(ctx, args),
    })
  }
  return out
}

function unwrapExec(deps: EngineDeps, db: Db, config: SessionContext['config']): ExecutionCreate {
  return (input) => {
    const r = deps.sandbox.executionCreate(db, config, input)
    if (!r.ok) throw new Error(`sandbox execution failed: ${r.error.kind}`)
    return r.value
  }
}

function buildBuiltInTools(ctx: SessionContext, executionCreate: ExecutionCreate): ToolSet {
  const { db, config, workDir, deps, agent: agentDef, ticket: ticketData, session } = ctx
  const foundryCtx: McpFoundryCtx = { db, config, sessionId: session.id, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name, sandboxToken: ctx.sandboxToken, executionCreate }
  const githubCtx:  McpGithubCtx  = { db, config, sessionId: session.id, workspace: workDir, ticket: ticketData, agentName: agentDef.name, executionCreate, projectGet: deps.crud.projectGetById }
  const sandboxCtx: McpSandboxCtx = { db, config, sessionId: session.id, workspace: workDir, executionCreate }
  return {
    ...toAiTools(deps.mcp.foundryServer.tools, foundryCtx),
    ...toAiTools(deps.mcp.githubServer.tools,  githubCtx),
    ...toAiTools(deps.mcp.sandboxServer.tools, sandboxCtx),
    ...toAiTools(deps.mcp.browserServer.tools, sandboxCtx),
  }
}

function attachConnectionTools(
  result: ToolSet, ctx: SessionContext, executionCreate: ExecutionCreate,
): void {
  const { db, config, workDir, deps, agent: agentDef, session } = ctx
  const conns = deps.crud.connectionByAccount(db, agentDef.account_id)
  for (const conn of conns) {
    const mod = deps.mcp.byConnectionKind[conn.kind]
    if (!mod) continue
    const { secrets, connConfig } = deps.mcp.parseConn(conn, deps.crud.decryptSecret)
    const prefix = `${conn.kind}-${conn.name}`
    const connCtx: McpConnCtx = { db, config, sessionId: session.id, workspace: workDir, secrets, connConfig, connectionName: conn.name, executionCreate }
    Object.assign(result, toAiTools(mod.tools, connCtx, prefix))
  }
}

function buildTools(ctx: SessionContext): ToolSet {
  const { db, config, deps } = ctx
  const executionCreate = unwrapExec(deps, db, config)
  const result = buildBuiltInTools(ctx, executionCreate)
  attachConnectionTools(result, ctx, executionCreate)
  return result
}

function contentPartsOf(result: StepResult): ContentPart[] {
  const c = (result as unknown as { content?: ContentPart[] }).content
  return Array.isArray(c) ? c : []
}

interface PartActivity { kind: 'said' | 'thought' | 'tool_call'; payload: unknown; tool_use_id: string | null; isToolCall: boolean }

function partToActivity(b: ContentPart): PartActivity | null {
  if (b.type === 'text' && typeof b.text === 'string') return { kind: 'said', payload: { text: b.text }, tool_use_id: null, isToolCall: false }
  if (b.type === 'reasoning' && typeof b.text === 'string') return { kind: 'thought', payload: { text: b.text, char_count: b.text.length, signature: b.signature ?? null }, tool_use_id: null, isToolCall: false }
  if (b.type === 'tool-call' && typeof b.toolCallId === 'string') return { kind: 'tool_call', payload: { name: b.toolName, input: b.args ?? b.input ?? {} }, tool_use_id: b.toolCallId, isToolCall: true }
  if (b.type === 'tool-result') return null
  return { kind: 'said', payload: b, tool_use_id: null, isToolCall: false }
}

function writeStepActivities(db: Db, deps: EngineDeps, sessionId: string, turnId: string, result: StepResult): number {
  const parts = contentPartsOf(result)
  const { inputTokens, outputTokens } = result.usage ?? {}
  let toolCalls = 0
  parts.forEach((b, idx) => {
    const act = partToActivity(b)
    if (!act) return
    if (act.isToolCall) toolCalls++
    deps.crud.activityCreate(db, activityFromPart(sessionId, turnId, idx, act, inputTokens, outputTokens))
  })
  return toolCalls
}

function activityFromPart(sessionId: string, turnId: string, idx: number, act: PartActivity, inputTokens: number | undefined, outputTokens: number | undefined): Record<string, unknown> {
  return {
    session_id: sessionId, turn_id: turnId, kind: act.kind, order_index: idx,
    payload: JSON.stringify(act.payload), tool_use_id: act.tool_use_id, execution_id: null,
    tokens_in: idx === 0 ? (inputTokens  ?? null) : null,
    tokens:    idx === 0 ? (outputTokens ?? null) : null,
    created_at: now(),
  }
}

interface EngineState {
  finishReason: string | null
  tokensIn: number; tokensOut: number; toolCalls: number; cancelled: boolean
}

function newState(): EngineState {
  return { finishReason: null, tokensIn: 0, tokensOut: 0, toolCalls: 0, cancelled: false }
}

export async function runEngine(ctx: SessionContext): Promise<LoopResult> {
  const { db, deps, systemPrompt, userPrompt, shouldStop, agent: agentDef, session } = ctx
  const model = resolveModelWithDefaults(db, deps, agentDef)
  const tools = buildTools(ctx)
  const messages: ModelMessage[] = [{ role: 'user', content: userPrompt }]
  const state = newState()
  for (let step = 0; step < agentDef.max_steps; step++) {
    if (shouldStop()) { state.cancelled = true; break }
    const result = await generateText({ model, system: systemPrompt, messages, tools, stopWhen: stepCountIs(1) })
    if (await applyStep(ctx, session.id, messages, result, state)) break
  }
  return { ...state, costUsd: 0 }
}

async function applyStep(
  ctx: SessionContext, sessionId: string, messages: ModelMessage[], result: StepResult, state: EngineState,
): Promise<boolean> {
  const { db, deps } = ctx
  const turnId = ulid()
  state.toolCalls += writeStepActivities(db, deps, sessionId, turnId, result)
  state.tokensIn  += result.usage?.inputTokens  ?? 0
  state.tokensOut += result.usage?.outputTokens ?? 0
  messages.push(...result.response.messages)
  state.finishReason = result.finishReason ?? null
  return state.finishReason === 'stop'
}
