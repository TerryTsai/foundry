// Claude Agent SDK loop — the subscription backend. Used for connections
// of kind 'anthropic-subscription'. The SDK streams a single BetaMessage
// across multiple emissions per turn; we merge incoming content blocks
// per turn and upsert one activity row per block keyed by (session_id,
// turn_id, order_index).

import { createSdkMcpServer, tool as sdkTool, query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { type Db } from '@foundry/db'
import type { Connection } from '@foundry/db'
import { now } from '@foundry/model'

import type { EngineDeps, SessionContext, LoopResult, ToolDef, ExecutionHandle } from '../types.js'

type Block = { type: string; id?: string; text?: string; thinking?: string; name?: string; input?: unknown; signature?: string }

// Read SDK on-disk credentials first (Claude Code refreshes them); fall
// back to stored connection secret. Keep DB in sync when file is newer.
function resolveSubscriptionToken(db: Db, deps: EngineDeps, conn: Connection): string {
  const fileToken = readFileToken()
  if (fileToken) {
    syncStoredToken(db, deps, conn, fileToken)
    return fileToken
  }
  const stored = readStoredToken(deps, conn)
  if (stored) return stored
  throw new Error(`connection '${conn.id}': no valid subscription token`)
}

function readFileToken(): string | null {
  try {
    const raw  = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf-8')
    const cred = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } }).claudeAiOauth
    if (cred?.accessToken && cred.expiresAt && cred.expiresAt > Date.now()) return cred.accessToken
  } catch { /* file missing */ }
  return null
}

function syncStoredToken(db: Db, deps: EngineDeps, conn: Connection, token: string): void {
  try {
    const stored = JSON.parse(deps.crud.decryptSecret(conn.secrets)) as Record<string, unknown>
    if (stored.access_token === token) return
    stored.access_token = token
    stored.api_key      = token
    deps.crud.connectionUpdateById(db, conn.id, {
      secrets:    deps.crud.encryptSecret(JSON.stringify(stored)),
      updated_at: new Date().toISOString(),
    })
  } catch { /* malformed stored secrets */ }
}

function readStoredToken(deps: EngineDeps, conn: Connection): string | null {
  try {
    const secrets = JSON.parse(deps.crud.decryptSecret(conn.secrets)) as Record<string, unknown>
    const v = secrets.access_token ?? secrets.api_key
    if (typeof v === 'string' && v) return v
  } catch { /* malformed */ }
  return null
}

// Merge incoming partial content list into the prior merged list for the
// same turn. Text/thinking grow with streaming; tool_use blocks append.
function mergeBlocks(prior: Block[], incoming: Block[]): Block[] {
  const merged = prior.slice()
  for (const b of incoming) mergeOneBlock(merged, b)
  return merged
}

function mergeOneBlock(merged: Block[], b: Block): void {
  if (b.type === 'tool_use' && b.id) {
    if (!merged.some(x => x.type === 'tool_use' && x.id === b.id)) merged.push(b)
    return
  }
  if (b.type === 'text')     return mergeGrowingBlock(merged, b, 'text')
  if (b.type === 'thinking') return mergeGrowingBlock(merged, b, 'thinking')
  merged.push(b)
}

function mergeGrowingBlock(merged: Block[], b: Block, key: 'text' | 'thinking'): void {
  const idx = merged.findIndex(x => x.type === b.type)
  if (idx < 0) { merged.push(b); return }
  const incomingLen = ((b[key] as string) ?? '').length
  const existingLen = ((merged[idx][key] as string) ?? '').length
  if (incomingLen >= existingLen) merged[idx] = b
}

function blockToActivity(b: Block): { kind: string; payload: unknown; tool_use_id?: string } {
  if (b.type === 'tool_use' && typeof b.id === 'string') {
    return { kind: 'tool_call', payload: { name: b.name ?? null, input: b.input ?? {} }, tool_use_id: b.id }
  }
  if (b.type === 'thinking' && typeof b.thinking === 'string') {
    return { kind: 'thought', payload: { text: b.thinking, char_count: b.thinking.length, signature: b.signature ?? null } }
  }
  if (b.type === 'text' && typeof b.text === 'string') {
    return { kind: 'said', payload: { text: b.text } }
  }
  return { kind: 'said', payload: { unknown_block: b } }
}

interface UpsertParams {
  sessionId: string; turnId: string; orderIndex: number
  kind: string; payload: unknown; tool_use_id?: string
  tokens_in?: number | null; tokens?: number | null
}

// Upsert a single activity row keyed by (session_id, turn_id, order_index).
function upsertActivity(db: Db, deps: EngineDeps, params: UpsertParams) {
  const existing = deps.crud.activityByTurnOrder(db, params.sessionId, params.turnId, params.orderIndex)
  const baseData = activityBaseData(params)
  if (existing) {
    deps.crud.activityUpdate(db, existing.id, { ...baseData, tokens_in: params.tokens_in ?? null, tokens: params.tokens ?? null })
    return existing
  }
  return deps.crud.activityCreate(db, activityCreatePayload(params, baseData))
}

function activityBaseData(params: UpsertParams): Record<string, unknown> {
  return {
    kind: params.kind,
    payload: JSON.stringify(params.payload),
    tool_use_id: params.tool_use_id ?? null,
    execution_id: null,
  }
}

function activityCreatePayload(params: UpsertParams, baseData: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: params.sessionId, turn_id: params.turnId, order_index: params.orderIndex,
    tokens_in: params.tokens_in ?? null, tokens: params.tokens ?? null,
    created_at: now(), ...baseData,
  }
}

function toSdkServer(
  deps: EngineDeps, name: string, defs: ToolDef[],
  serverCtx: unknown, allowed: string[] | '*' | null | undefined, isCancelled: () => boolean,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mcp tool ctx is structurally open
  const tu = (extra: unknown) => ({ ...(serverCtx as any), toolUseId: deps.mcp.toolUseId(extra) })
  const all = defs.map(t => wrapTool(deps, t, tu, isCancelled))
  return createSdkMcpServer({ name, tools: deps.mcp.filterTools(all, allowed) })
}

function wrapTool(
  deps: EngineDeps, t: ToolDef,
  tu: (extra: unknown) => unknown, isCancelled: () => boolean,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sdk shape
  return sdkTool(t.name, t.description, (t.schema as any).shape, async (a: any, x: unknown) => {
    if (isCancelled()) return deps.mcp.asText({ error: 'session cancelled' })
    const result = await t.handler(tu(x), a)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mcp envelope
    return deps.mcp.isMcpEnvelope(result) ? (result as any) : deps.mcp.asText(result)
  })
}

function unwrapExec(input: Parameters<typeof EngineDeps_sandbox_executionCreate>[2], db: Db, config: SessionContext['config'], deps: EngineDeps): ExecutionHandle {
  const r = deps.sandbox.executionCreate(db, config, input)
  if (!r.ok) throw new Error(`sandbox execution failed: ${r.error.kind}`)
  return r.value
}

// Type-level marker so `Parameters` resolves; not actually called.
declare const EngineDeps_sandbox_executionCreate: EngineDeps['sandbox']['executionCreate']

function buildMcpServers(ctx: SessionContext) {
  const { db, config, workDir, deps } = ctx
  const sessionId = ctx.session.id, agentDef = ctx.agent, ticketData = ctx.ticket
  const selection = deps.mcp.parseToolSelection(agentDef.tools)
  const executionCreate = (input: Parameters<typeof deps.sandbox.executionCreate>[2]) => unwrapExec(input, db, config, deps)
  const isCancelled = buildCancelCheck(deps, db, sessionId, ticketData.id)
  const ctxs = buildToolCtxs(ctx, executionCreate)
  return assembleMcpServers(deps, ctxs, selection, isCancelled, db, agentDef.account_id, sessionId, workDir, config, executionCreate)
}

function buildCancelCheck(deps: EngineDeps, db: Db, sessionId: string, ticketId: string): () => boolean {
  return () => {
    const t = deps.crud.ticketGetById(db, ticketId)
    if (!t || t.status !== 'running') return true
    const s = deps.crud.sessionGetById(db, sessionId)
    return !s || s.status !== 'running'
  }
}

function buildToolCtxs(ctx: SessionContext, executionCreate: (i: any) => ExecutionHandle) {
  const { db, config, workDir } = ctx
  const sessionId = ctx.session.id, agentDef = ctx.agent, ticketData = ctx.ticket
  return {
    foundry: { db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name, sandboxToken: ctx.sandboxToken, executionCreate },
    github:  { db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name, executionCreate },
    sandbox: { db, config, sessionId, workspace: workDir, executionCreate },
  }
}

function assembleMcpServers(
  deps: EngineDeps,
  ctxs: { foundry: unknown; github: unknown; sandbox: unknown },
  selection: ReturnType<EngineDeps['mcp']['parseToolSelection']>,
  isCancelled: () => boolean,
  db: Db, accountId: string, sessionId: string, workDir: string,
  config: SessionContext['config'],
  executionCreate: (i: any) => ExecutionHandle,
): Record<string, ReturnType<typeof createSdkMcpServer>> {
  const out: Record<string, ReturnType<typeof createSdkMcpServer>> = {}
  if (selection === null || 'foundry' in selection) out.foundry = toSdkServer(deps, 'foundry', deps.mcp.foundryServer.tools, ctxs.foundry, selection?.foundry, isCancelled)
  if (selection === null || 'github'  in selection) out.github  = toSdkServer(deps, 'github',  deps.mcp.githubServer.tools,  ctxs.github,  selection?.github,  isCancelled)
  if (selection === null || 'sandbox' in selection) out.sandbox = toSdkServer(deps, 'sandbox', deps.mcp.sandboxServer.tools, ctxs.sandbox, selection?.sandbox, isCancelled)
  if (selection === null || 'browser' in selection) out.browser = toSdkServer(deps, 'browser', deps.mcp.browserServer.tools, ctxs.sandbox, selection?.browser, isCancelled)
  attachConnectionServers(out, deps, db, accountId, sessionId, workDir, config, selection, isCancelled, executionCreate)
  return out
}

function attachConnectionServers(
  out: Record<string, ReturnType<typeof createSdkMcpServer>>,
  deps: EngineDeps, db: Db, accountId: string, sessionId: string, workDir: string,
  config: SessionContext['config'],
  selection: ReturnType<EngineDeps['mcp']['parseToolSelection']>,
  isCancelled: () => boolean,
  executionCreate: (i: any) => ExecutionHandle,
): void {
  const conns = deps.crud.connectionByAccount(db, accountId)
  for (const conn of conns) {
    const mod = deps.mcp.byConnectionKind[conn.kind]
    if (!mod) continue
    const key = `${conn.kind}:${conn.name}`
    if (selection !== null && !(key in selection)) continue
    const { secrets, connConfig } = deps.mcp.parseConn(conn, deps.crud.decryptSecret)
    const connCtx = { db, config, sessionId, workspace: workDir, secrets, connConfig, connectionName: conn.name, executionCreate }
    out[key] = toSdkServer(deps, key, mod.tools, connCtx, selection === null ? null : selection[key], isCancelled)
  }
}

interface TurnAccumulator {
  inputTokens: number; outputTokens: number; toolCallTotal: number
  costUsd: number; numTurns: number
  stopReason: string | null
  cancelled: boolean
  turnBlocks: Map<string, Block[]>
  turnMaxIn: Map<string, number>; turnMaxOut: Map<string, number>
}

function newAccumulator(): TurnAccumulator {
  return {
    inputTokens: 0, outputTokens: 0, toolCallTotal: 0,
    costUsd: 0, numTurns: 0, stopReason: null, cancelled: false,
    turnBlocks: new Map(), turnMaxIn: new Map(), turnMaxOut: new Map(),
  }
}

export async function runEngine(ctx: SessionContext): Promise<LoopResult> {
  const { db, deps } = ctx
  const conn = deps.crud.connectionGetById(db, ctx.agent.connection_id)
  if (!conn) throw new Error(`connection ${ctx.agent.connection_id} not found`)
  const oauthToken = resolveSubscriptionToken(db, deps, conn)
  const mcpServers = buildMcpServers(ctx)
  const acc = newAccumulator()
  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
  try { await drainQuery(ctx, mcpServers, acc) }
  finally { restoreToken(prevToken) }
  return finalizeAccumulator(acc)
}

function restoreToken(prevToken: string | undefined): void {
  if (prevToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
  else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
}

function finalizeAccumulator(acc: TurnAccumulator): LoopResult {
  return {
    finishReason: acc.stopReason ?? (acc.numTurns > 0 ? `sdk:${acc.numTurns}-turns` : null),
    tokensIn:  acc.inputTokens, tokensOut: acc.outputTokens,
    toolCalls: acc.toolCallTotal, costUsd: acc.costUsd,
    cancelled: acc.cancelled,
  }
}

async function drainQuery(
  ctx: SessionContext, mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>>, acc: TurnAccumulator,
): Promise<void> {
  const { systemPrompt, userPrompt, workDir, shouldStop, agent } = ctx
  for await (const message of query({
    prompt: userPrompt,
    options: { systemPrompt, cwd: workDir, tools: [], mcpServers, permissionMode: 'bypassPermissions', maxTurns: agent.max_steps, model: agent.model },
  })) {
    if (shouldStop()) { acc.cancelled = true; break }
    handleQueryMessage(ctx, message, acc)
  }
}

function handleQueryMessage(ctx: SessionContext, message: any, acc: TurnAccumulator): void {
  if (message.type === 'assistant') handleAssistant(ctx, message, acc)
  else if (message.type === 'result') handleResult(ctx, message, acc)
}

function handleAssistant(ctx: SessionContext, message: any, acc: TurnAccumulator): void {
  const turnId = message.message.id
  if (!turnId) return
  const incoming = (Array.isArray(message.message.content) ? message.message.content : []) as Block[]
  const prior = acc.turnBlocks.get(turnId) ?? []
  const merged = mergeBlocks(prior, incoming)
  acc.turnBlocks.set(turnId, merged)
  applyTurnUsageDelta(turnId, message.message.usage, acc)
  writeMergedActivities(ctx, turnId, merged, acc)
  acc.toolCallTotal += merged.filter(b => b.type === 'tool_use').length - prior.filter(b => b.type === 'tool_use').length
}

function applyTurnUsageDelta(turnId: string, u: any, acc: TurnAccumulator): void {
  const { turnIn, turnOut } = computeTurnUsage(u)
  const priorIn = acc.turnMaxIn.get(turnId) ?? 0
  const priorOut = acc.turnMaxOut.get(turnId) ?? 0
  acc.inputTokens  += Math.max(0, turnIn  - priorIn)
  acc.outputTokens += Math.max(0, turnOut - priorOut)
  acc.turnMaxIn .set(turnId, Math.max(priorIn,  turnIn))
  acc.turnMaxOut.set(turnId, Math.max(priorOut, turnOut))
}

function computeTurnUsage(u: any): { turnIn: number; turnOut: number } {
  const iters = u.iterations as Array<{ type?: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }> | undefined
  const msgIters = Array.isArray(iters) ? iters.filter(i => i.type === 'message' || i.type === undefined) : null
  if (msgIters && msgIters.length > 0) {
    const turnIn  = msgIters.reduce((s, i) => s + (i.input_tokens ?? 0) + (i.cache_read_input_tokens ?? 0) + (i.cache_creation_input_tokens ?? 0), 0)
    const turnOut = msgIters.reduce((s, i) => s + (i.output_tokens ?? 0), 0)
    return { turnIn, turnOut }
  }
  return { turnIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), turnOut: u.output_tokens ?? 0 }
}

function writeMergedActivities(ctx: SessionContext, turnId: string, merged: Block[], acc: TurnAccumulator): void {
  merged.forEach((b, idx) => {
    const { kind, payload, tool_use_id } = blockToActivity(b)
    upsertActivity(ctx.db, ctx.deps, {
      sessionId: ctx.session.id, turnId, orderIndex: idx,
      kind, payload, tool_use_id,
      tokens_in: idx === 0 ? acc.turnMaxIn.get(turnId) ?? 0 : null,
      tokens:    idx === 0 ? acc.turnMaxOut.get(turnId) ?? 0 : null,
    })
  })
}

function handleResult(ctx: SessionContext, message: any, acc: TurnAccumulator): void {
  acc.numTurns = message.num_turns
  acc.stopReason = message.stop_reason ?? message.subtype
  const models = Object.values(message.modelUsage) as Array<{ inputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; outputTokens: number; costUSD?: number }>
  const modelIn  = models.reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
  const modelOut = models.reduce((s, m) => s + m.outputTokens, 0)
  acc.costUsd = models.reduce((s, m) => s + (m.costUSD ?? 0), 0)
  reconcileSessionTokens(ctx, modelIn, modelOut, acc)
}

function reconcileSessionTokens(ctx: SessionContext, modelIn: number, modelOut: number, acc: TurnAccumulator): void {
  const deltaIn  = modelIn  - acc.inputTokens
  const deltaOut = modelOut - acc.outputTokens
  if (deltaIn === 0 && deltaOut === 0) return
  ctx.deps.crud.activityCreate(ctx.db, {
    session_id: ctx.session.id, turn_id: null, kind: 'reconcile',
    order_index: 0,
    payload: JSON.stringify({ deltaIn, deltaOut, modelIn, modelOut }),
    tool_use_id: null, execution_id: null,
    tokens_in: deltaIn, tokens: deltaOut, created_at: now(),
  })
}
