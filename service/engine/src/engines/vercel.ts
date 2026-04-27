// Vercel AI SDK loop — the non-subscription backend. One generateText
// call per step; each step's ContentPart[] is projected into activity rows.

import { generateText, stepCountIs, tool, type ModelMessage, type ToolSet } from 'ai'
import { ulid } from 'ulid'

import { now } from '@foundry/model'
import { decryptSecret } from '@foundry/crypto'

import { resolveModelWithDefaults } from './model-factory.js'
import type {
  SessionContext, LoopResult, ToolDef, ExecutionCreate,
  McpFoundryCtx, McpGithubCtx, McpSandboxCtx, McpConnCtx,
  AiToolInputSchema, StepResult, ContentPart, PartActivity, EngineState,
} from '../schema.js'

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

function unwrapExec(ctx: SessionContext): ExecutionCreate {
  return (input) => {
    const r = ctx.executionCreate(ctx.config, input)
    if (!r.ok) throw new Error(`sandbox execution failed: ${r.error.kind}`)
    return r.value
  }
}

function buildBuiltInTools(ctx: SessionContext, executionCreate: ExecutionCreate): ToolSet {
  const { db, config, workDir, agent: agentDef, ticket: ticketData, session, project, sandboxToken } = ctx
  const foundryCtx: McpFoundryCtx = { db, config, sessionId: session.id, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name, sandboxToken, executionCreate }
  const githubCtx:  McpGithubCtx  = { db, config, sessionId: session.id, workspace: workDir, ticket: ticketData, agentName: agentDef.name, executionCreate, projectGet: () => project }
  const sandboxCtx: McpSandboxCtx = { db, config, sessionId: session.id, workspace: workDir, executionCreate }
  return {
    ...toAiTools(ctx.foundryServer.tools, foundryCtx),
    ...toAiTools(ctx.githubServer.tools,  githubCtx),
    ...toAiTools(ctx.sandboxServer.tools, sandboxCtx),
    ...toAiTools(ctx.browserServer.tools, sandboxCtx),
  }
}

async function attachConnectionTools(
  result: ToolSet, ctx: SessionContext, executionCreate: ExecutionCreate,
): Promise<void> {
  const { db, config, workDir, agent: agentDef, session } = ctx
  const r = await ctx.crud.connectionByAccount(ctx.ctx, agentDef.account_id)
  const conns = r.ok ? r.value : []
  for (const conn of conns) {
    const mod = ctx.byConnectionKind[conn.kind]
    if (!mod) continue
    const { secrets, connConfig } = ctx.parseConn(conn, (s) => decryptSecret(s, ctx.encryptionKey))
    const prefix = `${conn.kind}-${conn.name}`
    const connCtx: McpConnCtx = { db, config, sessionId: session.id, workspace: workDir, secrets, connConfig, connectionName: conn.name, executionCreate }
    Object.assign(result, toAiTools(mod.tools, connCtx, prefix))
  }
}

async function buildTools(ctx: SessionContext): Promise<ToolSet> {
  const executionCreate = unwrapExec(ctx)
  const result = buildBuiltInTools(ctx, executionCreate)
  await attachConnectionTools(result, ctx, executionCreate)
  return result
}

function contentPartsOf(result: StepResult): ContentPart[] {
  const c = (result as unknown as { content?: ContentPart[] }).content
  return Array.isArray(c) ? c : []
}

function partToActivity(b: ContentPart): PartActivity | null {
  if (b.type === 'text' && typeof b.text === 'string') return { kind: 'said', payload: { text: b.text }, tool_use_id: null, isToolCall: false }
  if (b.type === 'reasoning' && typeof b.text === 'string') return { kind: 'thought', payload: { text: b.text, char_count: b.text.length, signature: b.signature ?? null }, tool_use_id: null, isToolCall: false }
  if (b.type === 'tool-call' && typeof b.toolCallId === 'string') return { kind: 'tool_call', payload: { name: b.toolName, input: b.args ?? b.input ?? {} }, tool_use_id: b.toolCallId, isToolCall: true }
  if (b.type === 'tool-result') return null
  return { kind: 'said', payload: b, tool_use_id: null, isToolCall: false }
}

async function writeStepActivities(ctx: SessionContext, sessionId: string, turnId: string, result: StepResult): Promise<number> {
  const parts = contentPartsOf(result)
  const { inputTokens, outputTokens } = result.usage ?? {}
  let toolCalls = 0
  for (let idx = 0; idx < parts.length; idx++) {
    const act = partToActivity(parts[idx])
    if (!act) continue
    if (act.isToolCall) toolCalls++
    await ctx.crud.activityCreate(ctx.ctx, activityFromPart(sessionId, turnId, idx, act, inputTokens, outputTokens))
  }
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

function newState(): EngineState {
  return { finishReason: null, tokensIn: 0, tokensOut: 0, toolCalls: 0, cancelled: false }
}

export async function runEngine(ctx: SessionContext): Promise<LoopResult> {
  const { systemPrompt, userPrompt, shouldStop, agent: agentDef, session } = ctx
  const model = await resolveModelWithDefaults(ctx, agentDef)
  const tools = await buildTools(ctx)
  const messages: ModelMessage[] = [{ role: 'user', content: userPrompt }]
  const state = newState()
  for (let step = 0; step < agentDef.max_steps; step++) {
    if (await shouldStop()) { state.cancelled = true; break }
    const result = await generateText({ model, system: systemPrompt, messages, tools, stopWhen: stepCountIs(1) })
    if (await applyStep(ctx, session.id, messages, result, state)) break
  }
  return { ...state, costUsd: 0 }
}

async function applyStep(
  ctx: SessionContext, sessionId: string, messages: ModelMessage[], result: StepResult, state: EngineState,
): Promise<boolean> {
  const turnId = ulid()
  state.toolCalls += await writeStepActivities(ctx, sessionId, turnId, result)
  state.tokensIn  += result.usage?.inputTokens  ?? 0
  state.tokensOut += result.usage?.outputTokens ?? 0
  messages.push(...result.response.messages)
  state.finishReason = result.finishReason ?? null
  return state.finishReason === 'stop'
}
