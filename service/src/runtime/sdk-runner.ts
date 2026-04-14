import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { sql, eq } from 'drizzle-orm'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Connection } from '../schema.js'
import * as schema from '../schema.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import * as domain from '../domain.js'
import { now, require } from '../functional.js'

import { workspaceEmpty, workspaceDestroy } from '../mcp/github.js'
import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'
import { parseToolSelection } from '../mcp/registry.js'
import * as providerRegistry from '../connections/registry.js'
import { buildConnectionServer } from '../connections/server.js'

// ════════════════════════════════════════════════════════════════════════════
// PROMPT ASSEMBLY
// ════════════════════════════════════════════════════════════════════════════
// The system prompt is assembled from every descriptive layer the founder
// has defined — account, project, agent, ticket — plus the full comment
// stream on this ticket. The resulting string is the agent's complete
// working context. We store it on session.system_prompt so historical
// sessions remain reproducible even after layers change.
//
// The SDK `prompt` arg carries a minimal trigger. The model already knows
// what to do from the system prompt.

function assembleSystemPrompt(db: Db, ticket: Ticket, agent: AgentDef): string | undefined {
  const project = database.projectGet(db, ticket.project_id)
  const account = project ? database.accountGet(db, project.owner_id) : undefined

  const parts: string[] = []
  const push = (heading: string, body: string | null | undefined) => {
    if (body && body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`)
  }

  push('Founder',    account?.description)
  push('Project',    project?.description)
  push('Your role',  agent.description)
  push('Ticket',     ticket.description)

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
// SESSION SUMMARY (closing ticket comment)
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
// SUBSCRIPTION TOKEN RESOLUTION
// ════════════════════════════════════════════════════════════════════════════
// Reads ~/.claude/.credentials.json first (kept fresh by Claude Code's own
// refresh cycle). If the file token is valid and differs from the stored
// connection secret, updates the connection row so the DB stays in sync.
// Falls back to the stored secret if the file is missing.

function resolveSubscriptionToken(db: Db, conn: Connection): string {
  const credPath = join(homedir(), '.claude', '.credentials.json')
  try {
    const raw = readFileSync(credPath, 'utf-8')
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
  } catch { /* file missing or unreadable */ }

  try {
    const secrets = JSON.parse(conn.secrets) as Record<string, unknown>
    const v = secrets.access_token ?? secrets.api_key
    if (typeof v === 'string' && v) return v
  } catch { /* malformed */ }

  throw new Error(`connection '${conn.id}': no valid subscription token`)
}

// ════════════════════════════════════════════════════════════════════════════
// BLOCK → ACTIVITY PROJECTION
// ════════════════════════════════════════════════════════════════════════════
// The SDK streams a single BetaMessage across multiple emissions during a
// single turn. Each emission carries a partial view of the content array
// (only the currently-streaming block, typically). We project the merged
// block stream into one `activity` row per block, keyed by
// (session_id, turn_id, order_index) so re-emissions upsert in place.
//
// Tokens are billed per BetaMessage (per turn), not per block. They live
// on the FIRST activity of the turn. Other activities in the same turn
// carry NULL for tokens_in/tokens. SUM across activities == modelUsage
// for the session.

type Block = { type: string; id?: string; text?: string; thinking?: string; name?: string; input?: unknown; signature?: string }

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
    return {
      kind:        'tool_call',
      payload:     { name: b.name ?? null, input: b.input ?? {} },
      tool_use_id: b.id,
    }
  }
  if (b.type === 'thinking' && typeof b.thinking === 'string') {
    return {
      kind:    'thought',
      payload: { text: b.thinking, char_count: b.thinking.length, signature: b.signature ?? null },
    }
  }
  if (b.type === 'text' && typeof b.text === 'string') {
    return { kind: 'said', payload: { text: b.text } }
  }
  // Unknown — preserve payload for audit.
  return { kind: 'said', payload: { unknown_block: b } }
}

// Upsert a single activity row keyed by (session_id, turn_id, order_index).
// If a row already exists for that triple, overwrite its content;
// tokens remain on whichever row carries them (the first block of the
// turn, set once on first sight and never moved).
function upsertActivity(db: Db, params: {
  sessionId: string
  turnId:    string
  orderIndex: number
  kind:      string
  payload:   unknown
  tool_use_id?: string
  execution_id?: string | null
  tokens_in?:   number | null
  tokens?:      number | null
}) {
  const existing = database.activityByTurnOrder(db, params.sessionId, params.turnId, params.orderIndex)
  const baseData = {
    kind:         params.kind,
    payload:      JSON.stringify(params.payload),
    tool_use_id:  params.tool_use_id ?? null,
    execution_id: params.execution_id ?? null,
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

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE AGENT SDK RUNNER
// ════════════════════════════════════════════════════════════════════════════

export async function runAgentSessionViaSdk(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  // Accumulators hoisted outside try so the catch block can still produce
  // a summary + persist cost when the SDK throws mid-stream.
  let inputTokens   = 0
  let outputTokens  = 0
  let toolCallTotal = 0
  let costUsd       = 0
  const conn       = require(database.connectionGet(db, agentDef.connection_id), 'connection not found')
  const oauthToken = resolveSubscriptionToken(db, conn)

  const workDir = await workspaceEmpty()
  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

  try {
    // Build and persist the system prompt up front so historical sessions
    // remain reproducible even if the layers (account/project/agent/ticket)
    // change later.
    const systemPrompt = assembleSystemPrompt(db, ticketData, agentDef)
    if (systemPrompt) database.sessionUpdate(db, sessionId, { system_prompt: systemPrompt })

    // Record the founder's trigger as a 'prompt' activity. No more 'user'
    // message — the activity is the primitive.
    const userPrompt = triggerPrompt(ticketData)
    database.activityInsert(db, {
      session_id:  sessionId,
      turn_id:     null,
      kind:        'prompt',
      order_index: 0,
      payload:     JSON.stringify({ text: userPrompt }),
      tool_use_id: null,
      execution_id: null,
      tokens_in:   null,
      tokens:      null,
      created_at:  now(),
    })

    // MCP servers, restricted by agent.tools. Missing keys = server not attached.
    const selection = parseToolSelection(agentDef.tools)
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
      mcpServers.sandbox = sandboxServer.buildSdk(
        { db, config, sessionId, workspace: workDir },
        selection?.sandbox,
      )
    }
    if (selection === null || 'browser' in selection) {
      mcpServers.browser = browserServer.buildSdk(
        { db, config, sessionId, workspace: workDir },
        selection?.browser,
      )
    }

    // Connection-contributed tool servers. For every connection the
    // account owns whose provider declares tools, mount an MCP server
    // at `<kind>:<connection.name>` (e.g. `cloudflare:prod`). Selection
    // gates access the same way built-in servers are gated.
    const accountConns = database.connectionAll(db, [eq(schema.connection.account_id, agentDef.account_id)])
    for (const conn of accountConns) {
      const provider = providerRegistry.providerGet(conn.kind)
      if (!provider?.tools?.length) continue
      const key = `${provider.kind}:${conn.name}`
      if (selection !== null && !(key in selection)) continue
      const server = buildConnectionServer(
        { db, config, sessionId, workspace: workDir },
        provider, conn,
        selection === null ? null : selection[key],
      )
      if (server) mcpServers[key] = server
    }

    let stopReason: string | null = null
    let numTurns = 0
    // Per-turn merge state + "first block of this turn has been written" flag
    // so tokens land on exactly one activity per turn.
    const turnBlocks      = new Map<string, Block[]>()   // turn_id → merged block list
    const turnTokensWritten = new Set<string>()          // turn_ids whose tokens have landed

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
      if (message.type === 'assistant') {
        const turnId = message.message.id
        if (!turnId) continue
        const u = message.message.usage
        const incoming = (Array.isArray(message.message.content) ? message.message.content : []) as Block[]
        const prior = turnBlocks.get(turnId) ?? []
        const merged = mergeBlocks(prior, incoming)
        turnBlocks.set(turnId, merged)

        // First emission for this turn: accumulate tokens once.
        let tokensInForRow: number | null = null
        let tokensForRow:   number | null = null
        if (!turnTokensWritten.has(turnId)) {
          const turnIn  = (u.input_tokens ?? 0)
                        + (u.cache_read_input_tokens ?? 0)
                        + (u.cache_creation_input_tokens ?? 0)
          const turnOut = u.output_tokens ?? 0
          inputTokens  += turnIn
          outputTokens += turnOut
          tokensInForRow = turnIn
          tokensForRow   = turnOut
          turnTokensWritten.add(turnId)
        }

        // Write one activity per merged block. Execution_id for tool_call is
        // filled at session close (the MCP handler hasn't run yet at this
        // stream point — the execution row appears between this emission
        // and the next).
        merged.forEach((b, idx) => {
          const { kind, payload, tool_use_id } = blockToActivity(b)
          // Tokens ride on the FIRST row of the turn (idx=0).
          upsertActivity(db, {
            sessionId:    sessionId,
            turnId,
            orderIndex:   idx,
            kind,
            payload,
            tool_use_id,
            execution_id: null,
            tokens_in:    idx === 0 ? tokensInForRow : null,
            tokens:       idx === 0 ? tokensForRow : null,
          })
        })

        // Running tool-call count: merged tool_use blocks, minus the prior
        // count for this turn (since upsert replaces rather than adds).
        const priorTools  = prior.filter(b => b.type === 'tool_use').length
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

        // Reconcile is its own first-class activity kind. Signed delta —
        // SUM over session activities now equals modelUsage exactly.
        if (deltaIn !== 0 || deltaOut !== 0) {
          database.activityInsert(db, {
            session_id:  sessionId,
            turn_id:     null,
            kind:        'reconcile',
            order_index: 0,
            payload:     JSON.stringify({ deltaIn, deltaOut, modelIn, modelOut }),
            tool_use_id: null,
            execution_id: null,
            tokens_in:   deltaIn,
            tokens:      deltaOut,
            created_at:  now(),
          })
        }
        database.sessionUpdate(db, sessionId, { cost_usd: costUsd })
      }
    }

    // Backfill execution_id on every tool_call activity for this session by
    // matching tool_use_id. The MCP handler completed between stream events,
    // so by now every tool_use block has its corresponding execution row.
    db.run(sql`
      UPDATE activity
         SET execution_id = (SELECT id FROM execution WHERE execution.tool_use_id = activity.tool_use_id)
       WHERE session_id = ${sessionId}
         AND kind = 'tool_call'
         AND execution_id IS NULL
         AND tool_use_id IS NOT NULL
    `)

    const durationMs = Date.now() - startTime
    const summary = summarizeSession(toolCallTotal, inputTokens, outputTokens, costUsd, durationMs)
    domain.ticketComplete(db, ticketData.id, { agentName: agentDef.name, sessionId, notes: summary })
    database.sessionUpdate(db, sessionId, {
      status:        'done',
      ended_at:      now(),
      duration_ms:   durationMs,
      finish_reason: stopReason ?? `sdk:${numTurns}-turns`,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Best-effort execution_id backfill even on failure — partial activities
    // still have useful sandbox-domain correlations.
    try {
      db.run(sql`
        UPDATE activity
           SET execution_id = (SELECT id FROM execution WHERE execution.tool_use_id = activity.tool_use_id)
         WHERE session_id = ${sessionId} AND kind = 'tool_call' AND execution_id IS NULL AND tool_use_id IS NOT NULL
      `)
    } catch {}
    const failSummary = summarizeSession(toolCallTotal, inputTokens, outputTokens, costUsd, Date.now() - startTime)
    const failNotes   = failSummary ? `${msg}\n\n${failSummary}` : msg
    try { domain.ticketFail(db, ticketData.id, { notes: failNotes, agentName: agentDef.name, sessionId }) } catch {}
    database.sessionUpdate(db, sessionId, {
      status:      'failed',
      error:       msg,
      ended_at:    now(),
      duration_ms: Date.now() - startTime,
      cost_usd:    costUsd,
    })
  } finally {
    if (prevToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    await workspaceDestroy(workDir)
  }
}
