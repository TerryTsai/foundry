// Claude Agent SDK loop — the subscription backend. Used for connections
// of kind 'anthropic-subscription'. The SDK streams a single BetaMessage
// across multiple emissions per turn; we merge incoming content blocks
// per turn and upsert one activity row per block keyed by (session_id,
// turn_id, order_index). Tokens ride on the first activity of the turn;
// SUM across activities == modelUsage exactly.

import { createSdkMcpServer, tool as sdkTool, query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { type Db } from '../../../core/db.js'
import * as database from '../../../core/db.js'
import type { Connection } from '../../../core/schema.js'
import { asText, isMcpEnvelope, parseConn, toolUseId } from '../../../integrations/shared.js'
import { now, mustExist } from '../../../core/util.js'
import { encryptSecret, decryptSecret } from '@foundry/crud'

import type { SessionContext, LoopResult } from '../pipeline/compose.js'
import { filterTools, parseToolSelection } from '../tools/registry.js'
import { byConnectionKind } from '../../../integrations/registry.js'
import type { ToolDef } from '../../../integrations/types.js'

import * as foundryServer from '../tools/foundry.js'
import * as githubServer  from '../../../integrations/github/tools.js'
import * as sandboxServer from '../tools/sandbox.js'
import * as browserServer from '../tools/browser.js'

type Block = { type: string; id?: string; text?: string; thinking?: string; name?: string; input?: unknown; signature?: string }


// Read the SDK's on-disk credentials first (Claude Code refreshes them).
// Fall back to the stored connection secret. Keep the DB in sync when the
// file token is newer than the stored one.
function resolveSubscriptionToken(db: Db, conn: Connection): string {
  const credPath = join(homedir(), '.claude', '.credentials.json')
  try {
    const raw  = readFileSync(credPath, 'utf-8')
    const cred = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } }).claudeAiOauth
    if (cred?.accessToken && cred.expiresAt && cred.expiresAt > Date.now()) {
      const stored = JSON.parse(decryptSecret(conn.secrets)) as Record<string, unknown>
      if (stored.access_token !== cred.accessToken) {
        stored.access_token = cred.accessToken
        stored.api_key      = cred.accessToken
        database.connectionUpdate(db, conn.id, {
          secrets:    encryptSecret(JSON.stringify(stored)),
          updated_at: new Date().toISOString(),
        })
      }
      return cred.accessToken
    }
  } catch { /* file missing */ }
  try {
    const secrets = JSON.parse(decryptSecret(conn.secrets)) as Record<string, unknown>
    const v = secrets.access_token ?? secrets.api_key
    if (typeof v === 'string' && v) return v
  } catch { /* malformed */ }
  throw new Error(`connection '${conn.id}': no valid subscription token`)
}

// Merge an incoming partial content list into the prior merged list for the
// same turn. Text/thinking blocks are replaced-by-longer (streaming grows);
// tool_use blocks append once per unique id.
function mergeBlocks(prior: Block[], incoming: Block[]): Block[] {
  const merged = prior.slice()
  for (const b of incoming) {
    if (b.type === 'tool_use' && b.id) {
      if (!merged.some(x => x.type === 'tool_use' && x.id === b.id)) merged.push(b)
      continue
    }
    if (b.type === 'text') {
      const idx = merged.findIndex(x => x.type === 'text')
      if (idx < 0) merged.push(b)
      else if ((b.text ?? '').length >= (merged[idx].text ?? '').length) merged[idx] = b
      continue
    }
    if (b.type === 'thinking') {
      const idx = merged.findIndex(x => x.type === 'thinking')
      if (idx < 0) merged.push(b)
      else if ((b.thinking ?? '').length >= (merged[idx].thinking ?? '').length) merged[idx] = b
      continue
    }
    merged.push(b)
  }
  return merged
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
// Tokens stay on whichever row carries them — set once on first sight.
function upsertActivity(db: Db, params: {
  sessionId: string; turnId: string; orderIndex: number
  kind: string; payload: unknown; tool_use_id?: string
  tokens_in?: number | null; tokens?: number | null
}) {
  const existing = database.activityByTurnOrder(db, params.sessionId, params.turnId, params.orderIndex)
  const baseData = {
    kind:         params.kind,
    payload:      JSON.stringify(params.payload),
    tool_use_id:  params.tool_use_id ?? null,
    execution_id: null,
  }
  // Tokens are re-applied on every upsert so the first-row snapshot
  // tracks the turn's growing usage (non-first rows stay null).
  if (existing) {
    database.activityUpdate(db, existing.id, {
      ...baseData,
      tokens_in: params.tokens_in ?? null,
      tokens:    params.tokens    ?? null,
    })
    return existing
  }
  return database.activityInsert(db, {
    session_id:  params.sessionId,
    turn_id:     params.turnId,
    order_index: params.orderIndex,
    tokens_in:   params.tokens_in ?? null,
    tokens:      params.tokens ?? null,
    created_at:  now(),
    ...baseData,
  })
}

function toSdkServer(
  name: string, defs: ToolDef[], serverCtx: unknown, allowed: string[] | '*' | null | undefined,
  isCancelled: () => boolean,
) {
  const tu = (extra: unknown) => ({ ...(serverCtx as any), toolUseId: toolUseId(extra) })
  const all = defs.map(t =>
    sdkTool(t.name, t.description, (t.schema as any).shape, async (a: any, x: unknown) => {
      // The SDK dispatches MCP handlers as soon as the model emits a
      // tool_use block, which can be AFTER we've already flipped the
      // ticket to cancelled but BEFORE our for-await loop sees the
      // corresponding assistant message and breaks. Guard here so no
      // side effects fire post-cancel.
      if (isCancelled()) return asText({ error: 'session cancelled' })
      const result = await t.handler(tu(x), a)
      // Handlers may return a pre-formed MCP envelope (image, document);
      // otherwise we JSON-wrap the plain result as text.
      return isMcpEnvelope(result) ? (result as any) : asText(result)
    })
  )
  return createSdkMcpServer({ name, tools: filterTools(all, allowed) })
}

function buildMcpServers(ctx: SessionContext) {
  const { db, config, workDir } = ctx
  const sessionId  = ctx.session.id
  const agentDef   = ctx.agent
  const ticketData = ctx.ticket
  const selection  = parseToolSelection(agentDef.tools)
  const mcpServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {}

  // Read fresh status from the DB on every tool dispatch — same check
  // as withCooperativeCancel but applied at the handler boundary.
  const isCancelled = () => {
    const t = database.ticketGet(db, ticketData.id)
    if (!t || t.status !== 'running') return true
    const s = database.sessionGet(db, sessionId)
    if (!s || s.status !== 'running') return true
    return false
  }

  const foundryCtx = { db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name, sandboxToken: ctx.sandboxToken }
  const githubCtx  = { db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name }
  const sandboxCtx = { db, config, sessionId, workspace: workDir }

  if (selection === null || 'foundry' in selection) mcpServers.foundry = toSdkServer('foundry', foundryServer.tools, foundryCtx, selection?.foundry, isCancelled)
  if (selection === null || 'github'  in selection) mcpServers.github  = toSdkServer('github',  githubServer.tools,  githubCtx,  selection?.github, isCancelled)
  if (selection === null || 'sandbox' in selection) mcpServers.sandbox = toSdkServer('sandbox', sandboxServer.tools, sandboxCtx, selection?.sandbox, isCancelled)
  if (selection === null || 'browser' in selection) mcpServers.browser = toSdkServer('browser', browserServer.tools, sandboxCtx, selection?.browser, isCancelled)

  const conns = database.connectionByAccount(db, agentDef.account_id)
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    if (!mod) continue
    const key = `${conn.kind}:${conn.name}`
    if (selection !== null && !(key in selection)) continue
    const { secrets, connConfig } = parseConn(conn)
    const connCtx = { db, config, sessionId, workspace: workDir, secrets, connConfig, connectionName: conn.name }
    mcpServers[key] = toSdkServer(key, mod.tools, connCtx, selection === null ? null : selection[key], isCancelled)
  }
  return mcpServers
}

export async function runEngine(ctx: SessionContext): Promise<LoopResult> {
  const { db, systemPrompt, userPrompt, workDir, shouldStop } = ctx
  const sessionId  = ctx.session.id
  const agentDef   = ctx.agent
  const conn       = mustExist(database.connectionGet(db, agentDef.connection_id), 'connection not found')
  const oauthToken = resolveSubscriptionToken(db, conn)
  const mcpServers = buildMcpServers(ctx)

  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

  let inputTokens   = 0
  let outputTokens  = 0
  let toolCallTotal = 0
  let costUsd       = 0
  let stopReason: string | null = null
  let numTurns      = 0
  let cancelled     = false

  const turnBlocks = new Map<string, Block[]>()
  // Per-turn usage high-water marks. The SDK emits many `assistant`
  // messages per turn; each carries a cumulative usage snapshot, and
  // output_tokens in particular grows monotonically as the response
  // streams. Locking on the first snapshot undercounts output massively
  // (see reconcile deltas). Instead track the latest per turn and add
  // only the delta over prior when the session total accumulates.
  const turnMaxIn  = new Map<string, number>()
  const turnMaxOut = new Map<string, number>()

  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        systemPrompt,
        cwd:             workDir,
        tools:           [],
        mcpServers,
        permissionMode:  'bypassPermissions',
        maxTurns:        agentDef.max_steps,
        model:           agentDef.model,
      },
    })) {
      if (shouldStop()) { cancelled = true; break }

      if (message.type === 'assistant') {
        const turnId = message.message.id
        if (!turnId) continue
        const u        = message.message.usage
        const incoming = (Array.isArray(message.message.content) ? message.message.content : []) as Block[]
        const prior    = turnBlocks.get(turnId) ?? []
        const merged   = mergeBlocks(prior, incoming)
        turnBlocks.set(turnId, merged)

        // When the turn used server-side tool loops, the top-level
        // output_tokens counts only the final response — iterations holds
        // each loop's usage. Same story for input on subscription
        // backends. Sum iterations when present, fall back otherwise.
        const iters = (u as { iterations?: Array<{ type?: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }> }).iterations
        const msgIters = Array.isArray(iters) ? iters.filter(i => i.type === 'message' || i.type === undefined) : null
        const turnIn  = msgIters && msgIters.length > 0
          ? msgIters.reduce((s, i) => s + (i.input_tokens ?? 0) + (i.cache_read_input_tokens ?? 0) + (i.cache_creation_input_tokens ?? 0), 0)
          : (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        const turnOut = msgIters && msgIters.length > 0
          ? msgIters.reduce((s, i) => s + (i.output_tokens ?? 0), 0)
          : (u.output_tokens ?? 0)
        const priorIn  = turnMaxIn .get(turnId) ?? 0
        const priorOut = turnMaxOut.get(turnId) ?? 0
        inputTokens  += Math.max(0, turnIn  - priorIn )
        outputTokens += Math.max(0, turnOut - priorOut)
        turnMaxIn .set(turnId, Math.max(priorIn,  turnIn ))
        turnMaxOut.set(turnId, Math.max(priorOut, turnOut))

        merged.forEach((b, idx) => {
          const { kind, payload, tool_use_id } = blockToActivity(b)
          upsertActivity(db, {
            sessionId, turnId, orderIndex: idx,
            kind, payload, tool_use_id,
            tokens_in: idx === 0 ? turnMaxIn .get(turnId) ?? 0 : null,
            tokens:    idx === 0 ? turnMaxOut.get(turnId) ?? 0 : null,
          })
        })

        const priorTools  = prior .filter(b => b.type === 'tool_use').length
        const mergedTools = merged.filter(b => b.type === 'tool_use').length
        toolCallTotal += (mergedTools - priorTools)

      } else if (message.type === 'result') {
        numTurns   = message.num_turns
        stopReason = message.stop_reason ?? message.subtype

        const models   = Object.values(message.modelUsage)
        const modelIn  = models.reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
        const modelOut = models.reduce((s, m) => s + m.outputTokens, 0)
        costUsd        = models.reduce((s, m) => s + (m.costUSD ?? 0), 0)
        const deltaIn  = modelIn  - inputTokens
        const deltaOut = modelOut - outputTokens

        // Reconcile delta — SUM over activities now equals modelUsage.
        if (deltaIn !== 0 || deltaOut !== 0) {
          database.activityInsert(db, {
            session_id:   sessionId,
            turn_id:      null,
            kind:         'reconcile',
            order_index:  0,
            payload:      JSON.stringify({ deltaIn, deltaOut, modelIn, modelOut }),
            tool_use_id:  null,
            execution_id: null,
            tokens_in:    deltaIn,
            tokens:       deltaOut,
            created_at:   now(),
          })
        }
      }
    }
  } finally {
    if (prevToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  }

  return {
    finishReason: stopReason ?? (numTurns > 0 ? `sdk:${numTurns}-turns` : null),
    tokensIn:     inputTokens,
    tokensOut:    outputTokens,
    toolCalls:    toolCallTotal,
    costUsd,
    cancelled,
  }
}
