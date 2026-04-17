// Claude Agent SDK loop — the subscription backend. Used for connections
// of kind 'anthropic-subscription'. The SDK streams a single BetaMessage
// across multiple emissions per turn; we merge incoming content blocks
// per turn and upsert one activity row per block keyed by (session_id,
// turn_id, order_index). Tokens ride on the first activity of the turn;
// SUM across activities == modelUsage exactly.

import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { type Db } from '../../database.js'
import * as database from '../../database.js'
import type { Connection } from '../../tables.js'
import { now, mustExist } from '../../util.js'

import type { SessionContext, LoopResult } from '../compose.js'

import * as foundryServer from '../../mcp/foundry.js'
import * as githubServer  from '../../mcp/github.js'
import * as sandboxServer from '../../mcp/sandbox.js'
import * as browserServer from '../../mcp/browser.js'
import { parseToolSelection, byConnectionKind } from '../../mcp/registry.js'

type Block = { type: string; id?: string; text?: string; thinking?: string; name?: string; input?: unknown; signature?: string }

function parseConn(conn: Connection): { secrets: Record<string, string>; connConfig: Record<string, unknown> } {
  let secrets:    Record<string, string>  = {}
  let connConfig: Record<string, unknown> = {}
  try { secrets    = JSON.parse(conn.secrets) as Record<string, string>  } catch { /* malformed */ }
  try { connConfig = JSON.parse(conn.config)  as Record<string, unknown> } catch { /* malformed */ }
  return { secrets, connConfig }
}

// Read the SDK's on-disk credentials first (Claude Code refreshes them).
// Fall back to the stored connection secret. Keep the DB in sync when the
// file token is newer than the stored one.
function resolveSubscriptionToken(db: Db, conn: Connection): string {
  const credPath = join(homedir(), '.claude', '.credentials.json')
  try {
    const raw  = readFileSync(credPath, 'utf-8')
    const cred = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } }).claudeAiOauth
    if (cred?.accessToken && cred.expiresAt && cred.expiresAt > Date.now()) {
      const stored = JSON.parse(conn.secrets) as Record<string, unknown>
      if (stored.access_token !== cred.accessToken) {
        stored.access_token = cred.accessToken
        stored.api_key      = cred.accessToken
        database.connectionUpdate(db, conn.id, {
          secrets:    JSON.stringify(stored),
          updated_at: new Date().toISOString(),
        })
      }
      return cred.accessToken
    }
  } catch { /* file missing */ }
  try {
    const secrets = JSON.parse(conn.secrets) as Record<string, unknown>
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
  if (existing) {
    database.activityUpdate(db, existing.id, baseData)
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

function buildMcpServers(ctx: SessionContext): Record<string, ReturnType<typeof foundryServer.buildSdk>> {
  const { db, config, workDir } = ctx
  const sessionId  = ctx.session.id
  const agentDef   = ctx.agent
  const ticketData = ctx.ticket
  const selection  = parseToolSelection(agentDef.tools)
  const mcpServers: Record<string, ReturnType<typeof foundryServer.buildSdk>> = {}

  if (selection === null || 'foundry' in selection) {
    mcpServers.foundry = foundryServer.buildSdk(
      { db, config, sessionId, workspace: workDir, projectId: ticketData.project_id, accountId: agentDef.account_id, ticketId: ticketData.id, agentName: agentDef.name },
      selection?.foundry,
    )
  }
  if (selection === null || 'github' in selection) {
    mcpServers.github = githubServer.buildSdk(
      { db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name },
      selection?.github,
    )
  }
  if (selection === null || 'sandbox' in selection) {
    mcpServers.sandbox = sandboxServer.buildSdk({ db, config, sessionId, workspace: workDir }, selection?.sandbox)
  }
  if (selection === null || 'browser' in selection) {
    mcpServers.browser = browserServer.buildSdk({ db, config, sessionId, workspace: workDir }, selection?.browser)
  }

  const conns = database.connectionByAccount(db, agentDef.account_id)
  for (const conn of conns) {
    const mod = byConnectionKind[conn.kind as keyof typeof byConnectionKind]
    if (!mod) continue
    const key = `${conn.kind}:${conn.name}`
    if (selection !== null && !(key in selection)) continue
    const { secrets, connConfig } = parseConn(conn)
    mcpServers[key] = mod.buildSdk({
      db, config, sessionId, workspace: workDir,
      secrets, connConfig, connectionName: conn.name,
    }, selection === null ? null : selection[key])
  }
  return mcpServers
}

export async function runAnthropicLoop(ctx: SessionContext): Promise<LoopResult> {
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

  const turnBlocks        = new Map<string, Block[]>()
  const turnTokensWritten = new Set<string>()

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

        let tokensInForRow: number | null = null
        let tokensForRow:   number | null = null
        if (!turnTokensWritten.has(turnId)) {
          const turnIn  = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          const turnOut = u.output_tokens ?? 0
          inputTokens   += turnIn
          outputTokens  += turnOut
          tokensInForRow = turnIn
          tokensForRow   = turnOut
          turnTokensWritten.add(turnId)
        }

        merged.forEach((b, idx) => {
          const { kind, payload, tool_use_id } = blockToActivity(b)
          upsertActivity(db, {
            sessionId, turnId, orderIndex: idx,
            kind, payload, tool_use_id,
            tokens_in: idx === 0 ? tokensInForRow : null,
            tokens:    idx === 0 ? tokensForRow   : null,
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
