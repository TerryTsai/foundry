// Claude Agent SDK loop — the subscription backend. Used for connections
// of kind 'anthropic-subscription'. The SDK streams a single BetaMessage
// across multiple emissions per turn; we merge incoming content blocks
// per turn and upsert one activity row per block keyed by (session_id,
// turn_id, order_index).

import { createSdkMcpServer, tool as sdkTool, query, type SDKAssistantMessage, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { homedir } from 'os'
import type { ZodObject, ZodRawShape } from 'zod'

import { type Db } from '@foundry/db'
import type { Connection } from '@foundry/db'
import { now } from '@foundry/model'

import type {
  EngineDeps, SessionContext, LoopResult, ToolDef, ExecutionCreate,
  McpConnCtx,
  SdkMcpServer, Block, UpsertParams, ToolCtxs, TurnAccumulator, UsageShape,
} from '../types.js'

// SDK's binary resolver tries `@anthropic-ai/claude-agent-sdk-linux-x64-musl`
// before the glibc variant. The musl package's lockfile entry is missing
// the libc constraint, so npm installs both on any Linux x64 host — and
// the SDK happily picks the musl one, which can't be spawned on glibc
// (no /lib/ld-musl-x86_64.so.1). Pin the gnu binary explicitly here.
// Drop this once the upstream lockfile carries libc.
function resolveClaudeBinary(): string | undefined {
  if (process.platform !== 'linux' || process.arch !== 'x64') return undefined
  try { return createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk-linux-x64/claude') }
  catch { return undefined }
}

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

function toSdkServer<TCtx>(
  deps: EngineDeps, name: string, defs: ToolDef<TCtx>[],
  serverCtx: TCtx, allowed: string[] | '*' | null | undefined, isCancelled: () => boolean,
): SdkMcpServer {
  const tu = (extra: unknown): TCtx => ({ ...serverCtx, toolUseId: deps.mcp.toolUseId(extra) })
  const all = defs.map(t => wrapTool(deps, t, tu, isCancelled))
  return createSdkMcpServer({ name, tools: deps.mcp.filterTools(all, allowed) })
}

function wrapTool<TCtx>(
  deps: EngineDeps, t: ToolDef<TCtx>,
  tu: (extra: unknown) => TCtx, isCancelled: () => boolean,
) {
  const shape = (t.schema as ZodObject<ZodRawShape>).shape
  return sdkTool(t.name, t.description, shape, async (args: unknown, extra: unknown): Promise<CallToolResult> => {
    if (isCancelled()) return deps.mcp.asText({ error: 'session cancelled' }) as CallToolResult
    const result = await t.handler(tu(extra), args)
    const envelope = deps.mcp.isMcpEnvelope(result) ? result : deps.mcp.asText(result)
    return envelope as CallToolResult
  })
}

function unwrapExec(deps: EngineDeps, db: Db, config: SessionContext['config']): ExecutionCreate {
  return (input) => {
    const r = deps.sandbox.executionCreate(db, config, input)
    if (!r.ok) throw new Error(`sandbox execution failed: ${r.error.kind}`)
    return r.value
  }
}

function buildMcpServers(ctx: SessionContext): Record<string, SdkMcpServer> {
  const { db, config, workDir, deps } = ctx
  const sessionId = ctx.session.id, agentDef = ctx.agent, ticketData = ctx.ticket
  const selection = deps.mcp.parseToolSelection(agentDef.tools)
  const executionCreate = unwrapExec(deps, db, config)
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

function buildToolCtxs(ctx: SessionContext, executionCreate: ExecutionCreate): ToolCtxs {
  const { db, config, workDir } = ctx
  const sessionId = ctx.session.id, agentDef = ctx.agent, ticketData = ctx.ticket
  return {
    foundry: { db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name, sandboxToken: ctx.sandboxToken, executionCreate },
    github:  { db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name, executionCreate, projectGet: ctx.deps.crud.projectGetById },
    sandbox: { db, config, sessionId, workspace: workDir, executionCreate },
  }
}

function assembleMcpServers(
  deps: EngineDeps,
  ctxs: ToolCtxs,
  selection: ReturnType<EngineDeps['mcp']['parseToolSelection']>,
  isCancelled: () => boolean,
  db: Db, accountId: string, sessionId: string, workDir: string,
  config: SessionContext['config'],
  executionCreate: ExecutionCreate,
): Record<string, SdkMcpServer> {
  const out: Record<string, SdkMcpServer> = {}
  if (selection === null || 'foundry' in selection) out.foundry = toSdkServer(deps, 'foundry', deps.mcp.foundryServer.tools, ctxs.foundry, selection?.foundry, isCancelled)
  if (selection === null || 'github'  in selection) out.github  = toSdkServer(deps, 'github',  deps.mcp.githubServer.tools,  ctxs.github,  selection?.github,  isCancelled)
  if (selection === null || 'sandbox' in selection) out.sandbox = toSdkServer(deps, 'sandbox', deps.mcp.sandboxServer.tools, ctxs.sandbox, selection?.sandbox, isCancelled)
  if (selection === null || 'browser' in selection) out.browser = toSdkServer(deps, 'browser', deps.mcp.browserServer.tools, ctxs.sandbox, selection?.browser, isCancelled)
  attachConnectionServers(out, deps, db, accountId, sessionId, workDir, config, selection, isCancelled, executionCreate)
  return out
}

function attachConnectionServers(
  out: Record<string, SdkMcpServer>,
  deps: EngineDeps, db: Db, accountId: string, sessionId: string, workDir: string,
  config: SessionContext['config'],
  selection: ReturnType<EngineDeps['mcp']['parseToolSelection']>,
  isCancelled: () => boolean,
  executionCreate: ExecutionCreate,
): void {
  const conns = deps.crud.connectionByAccount(db, accountId)
  for (const conn of conns) {
    const mod = deps.mcp.byConnectionKind[conn.kind]
    if (!mod) continue
    const key = `${conn.kind}:${conn.name}`
    if (selection !== null && !(key in selection)) continue
    const { secrets, connConfig } = deps.mcp.parseConn(conn, deps.crud.decryptSecret)
    const connCtx: McpConnCtx = { db, config, sessionId, workspace: workDir, secrets, connConfig, connectionName: conn.name, executionCreate }
    out[key] = toSdkServer(deps, key, mod.tools, connCtx, selection === null ? null : selection[key], isCancelled)
  }
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
    options: { systemPrompt, cwd: workDir, tools: [], mcpServers, permissionMode: 'bypassPermissions', maxTurns: agent.max_steps, model: agent.model, pathToClaudeCodeExecutable: resolveClaudeBinary() },
  })) {
    if (shouldStop()) { acc.cancelled = true; break }
    handleQueryMessage(ctx, message, acc)
  }
}

function handleQueryMessage(ctx: SessionContext, message: SDKMessage, acc: TurnAccumulator): void {
  if (message.type === 'assistant') handleAssistant(ctx, message, acc)
  else if (message.type === 'result') handleResult(ctx, message, acc)
}

function handleAssistant(ctx: SessionContext, message: SDKAssistantMessage, acc: TurnAccumulator): void {
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

function applyTurnUsageDelta(turnId: string, u: UsageShape | undefined, acc: TurnAccumulator): void {
  const { turnIn, turnOut } = computeTurnUsage(u)
  const priorIn = acc.turnMaxIn.get(turnId) ?? 0
  const priorOut = acc.turnMaxOut.get(turnId) ?? 0
  acc.inputTokens  += Math.max(0, turnIn  - priorIn)
  acc.outputTokens += Math.max(0, turnOut - priorOut)
  acc.turnMaxIn .set(turnId, Math.max(priorIn,  turnIn))
  acc.turnMaxOut.set(turnId, Math.max(priorOut, turnOut))
}

function computeTurnUsage(u: UsageShape | undefined): { turnIn: number; turnOut: number } {
  if (!u) return { turnIn: 0, turnOut: 0 }
  const iters = u.iterations
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

function handleResult(ctx: SessionContext, message: SDKResultMessage, acc: TurnAccumulator): void {
  acc.numTurns = message.num_turns
  acc.stopReason = message.stop_reason ?? message.subtype
  const models = Object.values(message.modelUsage)
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
