import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import type { Connection } from '../schema.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import * as domain from '../domain.js'
import { now, require } from '../functional.js'

// ── Block merge ──
// Union `incoming` into `prior` for one BetaMessage across SDK stream
// emissions. Preserves block order, dedupes tool_use by `id`, and keeps
// the longest version of any streamed text / thinking block.

type ContentBlock = { type: string; id?: string; text?: string; thinking?: string }

function mergeBlocks(prior: ContentBlock[], incoming: ContentBlock[]): ContentBlock[] {
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
    // Unknown block type — append conservatively.
    merged.push(b)
  }
  return merged
}

// ── Session summary formatter ──
// Produces the compact closing line posted as the single ticket comment
// when a session finishes. Keeps the ticket view scannable: one line per
// session with what it cost, not a dump of the model's final text.

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function summarizeSession(toolCalls: number, tokensIn: number, tokensOut: number, costUsd: number, durationMs: number): string {
  const parts: string[] = []
  if (toolCalls > 0)       parts.push(`${toolCalls} tool${toolCalls === 1 ? '' : 's'}`)
  if (tokensIn + tokensOut > 0) parts.push(`${fmtTokensShort(tokensIn)} in · ${fmtTokensShort(tokensOut)} out`)
  if (costUsd > 0)         parts.push(`$${costUsd.toFixed(4)}`)
  if (durationMs > 0)      parts.push(`${(durationMs / 1000).toFixed(1)}s`)
  return parts.length > 0 ? parts.join(' · ') : ''
}

// ── Subscription token resolution ──
// Reads ~/.claude/.credentials.json first (kept fresh by Claude Code's own
// refresh cycle). If the file token is valid and differs from the stored
// connection secret, updates the connection row so the DB stays in sync.
// Falls back to the stored secret if the file is missing or unreadable
// (e.g., server running on a different machine without Claude Code).

function resolveSubscriptionToken(db: Db, conn: Connection): string {
  const credPath = join(homedir(), '.claude', '.credentials.json')
  try {
    const raw = readFileSync(credPath, 'utf-8')
    const cred = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } }).claudeAiOauth
    if (cred?.accessToken && cred.expiresAt && cred.expiresAt > Date.now()) {
      // File token is fresh — use it. Update the connection row if it changed.
      const stored = JSON.parse(conn.secrets) as Record<string, unknown>
      if (stored.access_token !== cred.accessToken) {
        stored.access_token = cred.accessToken
        stored.api_key = cred.accessToken  // legacy fallback field
        database.connectionUpdate(db, conn.id, {
          secrets: JSON.stringify(stored),
          updated_at: new Date().toISOString(),
        })
      }
      return cred.accessToken
    }
  } catch { /* file missing or unreadable — fall through to stored secret */ }

  // Fall back to whatever is in the connection row.
  try {
    const secrets = JSON.parse(conn.secrets) as Record<string, unknown>
    const v = secrets.access_token ?? secrets.api_key
    if (typeof v === 'string' && v) return v
  } catch { /* malformed secrets */ }

  throw new Error(`connection '${conn.id}': no valid subscription token (credentials file missing and connection secrets empty)`)
}

import { workspaceEmpty, workspaceDestroy } from '../mcp/github.js'
import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'
import { parseToolSelection } from '../mcp/registry.js'

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE AGENT SDK BACKEND
// ════════════════════════════════════════════════════════════════════════════
// Alternate runtime for agents whose connection.kind is 'anthropic-subscription'.
// The SDK drives the agent loop and bills against a Claude Pro/Max subscription
// via CLAUDE_CODE_OAUTH_TOKEN (obtained once via `claude setup-token`). Tool
// calls go through Foundry's four in-process MCP servers (foundry, github,
// sandbox, browser). Built-in SDK tools are disabled via `tools: []` so the
// model can only use the Foundry surface.
//
// Workspace and publishing are both fully agent-driven. The runner
// allocates an empty tmpdir at /work and nothing more. The agent is
// responsible for cloning (gitClone), bootstrapping (exec), making
// changes, staging (gitAdd/gitCommit), and publishing (pullRequestCreate).
// If the agent finishes without publishing, the session branch never
// reaches GitHub and the workspace tmpdir is destroyed.

export async function runAgentSessionViaSdk(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  // Accumulators hoisted outside the try so the catch block can still
  // produce a summary + persist cost when the SDK throws mid-stream.
  let inputTokens  = 0
  let outputTokens = 0
  let toolCallTotal = 0
  let costUsd       = 0
  const conn = require(database.connectionGet(db, agentDef.connection_id), 'connection not found')
  const oauthToken = resolveSubscriptionToken(db, conn)

  // Empty workspace — agent owns clone / bootstrap via gitClone tool.
  const workDir = await workspaceEmpty()

  // Inject the OAuth token. Single-process / single-subscription = no race.
  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

  try {
    // Build the system prompt: project description + agent role prompt.
    // Prior to this, the SDK runner was running without the agent's own
    // prompt — a long-standing oversight. Tool descriptions + ticket body
    // carried enough signal for basic tasks, but complex agent
    // personalities (Backend Developer's style rules, etc.) were lost.
    const proj = database.projectGet(db, ticketData.project_id)
    const systemParts: string[] = []
    if (proj?.description?.trim()) systemParts.push(`## Project\n\n${proj.description.trim()}`)
    if (agentDef.prompt.trim())     systemParts.push(agentDef.prompt.trim())
    const systemPrompt = systemParts.join('\n\n---\n\n') || undefined

    const priorHistory = domain.ticketPriorHistory(db, ticketData.id, sessionId, agentDef.name)
    const prompt = priorHistory
      ? `${ticketData.body}\n\n---\n\n${priorHistory}`
      : ticketData.body
    domain.sessionMessage(db, sessionId, 'user', prompt)
    if (systemPrompt) database.sessionUpdate(db, sessionId, { system_prompt: systemPrompt })

    // Build the four in-process MCP servers, each restricted to the tools
    // selected on this agent. A null selection (legacy/unconfigured agents)
    // means all servers, all tools. An omitted server key means the server
    // is not attached to the session at all — a Product Vision agent with
    // no `github.gitMerge` in its selection literally cannot merge code.
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

    let stopReason: string | null = null
    let numTurns = 0
    // The SDK streams a single BetaMessage across multiple emissions — each
    // emission carries only the currently-streaming block (tool_use,
    // thinking, or text), not the cumulative set. If we simply overwrite
    // on repeat `msgId` we end up storing just the LAST block, silently
    // dropping the others. Observed: a turn with 5 parallel tool_use
    // blocks was persisted as 1 tool_use (the final one in the stream).
    //
    // Fix: accumulate blocks per `msgId` across emissions. tool_use blocks
    // dedupe by their `id` (Anthropic assigns a unique `toolu_…` per
    // invocation). text and thinking blocks dedupe by taking whichever
    // version is longest (streaming grows the text; later emissions
    // supersede earlier partials). On each emission we rewrite the
    // message row with the merged block list so `tool_call_count` and the
    // stored content stay accurate without re-adding tokens.
    const seenMessages      = new Map<string, string>()              // msgId → row id
    const accumulatedBlocks = new Map<string, Array<{ type: string; id?: string; text?: string; thinking?: string }>>()
    const messageToolCounts = new Map<string, number>()              // msgId → last persisted tool_call_count

    // Persist tokens incrementally, one row per assistant turn. Previously we
    // read `modelUsage` off the final `result` message and wrote a single
    // aggregate row — but if the SDK throws before emitting `result` (network
    // error, rate limit mid-run, subscription token expired) the whole
    // session had zero tokens recorded despite the billing having already
    // happened. Writing per-turn means failed runs still have an accurate
    // record up to the point of failure, and analytics gain per-turn
    // granularity (cost-per-tool-call, slowest turn, etc.).
    for await (const message of query({
      prompt,
      options: {
        systemPrompt,
        cwd:             workDir,
        tools:           [],          // disable all built-ins; only Foundry MCP tools
        mcpServers,
        permissionMode:  'bypassPermissions',
        maxTurns:        agentDef.max_steps,
        model:           agentDef.model,
      },
    })) {
      if (message.type === 'assistant') {
        const msgId = message.message.id
        const u = message.message.usage
        const incoming = (Array.isArray(message.message.content) ? message.message.content : []) as ContentBlock[]
        // Merge incoming blocks into whatever we've seen for this msgId so
        // the stored content reflects the full turn, not just the last
        // streamed block. First emission of a msgId starts fresh.
        const prior  = msgId ? accumulatedBlocks.get(msgId) ?? [] : []
        const blocks = msgId ? mergeBlocks(prior, incoming) : incoming
        if (msgId) accumulatedBlocks.set(msgId, blocks)

        const toolCalls = blocks.filter(b => b.type === 'tool_use').length
        // Readable text body when present, else a compact JSON dump of the
        // block list. Timeline view treats JSON-looking content as mono.
        const textParts: string[] = []
        for (const b of blocks) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) textParts.push(b.text)
        }
        const body = textParts.length > 0 ? textParts.join('\n\n') : JSON.stringify(blocks)

        const existingRowId = msgId ? seenMessages.get(msgId) : undefined
        if (existingRowId) {
          // Subsequent emission of the same BetaMessage. Content is now the
          // merged view; do NOT re-add tokens (billing already counted once
          // on the first emission). Adjust the running tool-call total by
          // the delta so it stays in sync with the merged blocks.
          database.messageUpdate(db, existingRowId, { content: body, tool_call_count: toolCalls })
          toolCallTotal += toolCalls - (messageToolCounts.get(msgId ?? '') ?? 0)
        } else {
          // First emission. Input = prompt + cache reads + cache creation;
          // each turn re-bills the full history so summing per-turn input
          // matches result.modelUsage cumulatively.
          const turnIn  = (u.input_tokens ?? 0)
                        + (u.cache_read_input_tokens ?? 0)
                        + (u.cache_creation_input_tokens ?? 0)
          const turnOut = u.output_tokens ?? 0
          inputTokens  += turnIn
          outputTokens += turnOut
          toolCallTotal += toolCalls
          const row = domain.sessionMessage(db, sessionId, 'assistant', body, turnOut, turnIn, toolCalls)
          if (msgId) seenMessages.set(msgId, row.id)
        }
        if (msgId) messageToolCounts.set(msgId, toolCalls)
      } else if (message.type === 'result') {
        numTurns   = message.num_turns
        stopReason = message.stop_reason ?? message.subtype
        // modelUsage is the SDK's authoritative cumulative per-model rollup
        // — it includes billable work that doesn't surface as 'assistant'
        // stream messages (internal SDK iterations, context reshaping, etc.).
        // After the run, write a single reconciliation row carrying the
        // SIGNED delta so SUM(message tokens) == modelUsage exactly. Signed
        // deltas mean an over-count (e.g. a missed dedupe) corrects
        // downward; under-count corrects upward. The synthetic row is
        // skipped when delta is zero.
        const models   = Object.values(message.modelUsage)
        const modelIn  = models.reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
        const modelOut = models.reduce((s, m) => s + m.outputTokens, 0)
        costUsd        = models.reduce((s, m) => s + (m.costUSD ?? 0), 0)
        const deltaIn  = modelIn  - inputTokens
        const deltaOut = modelOut - outputTokens
        if (deltaIn !== 0 || deltaOut !== 0) {
          domain.sessionMessage(db, sessionId, 'system',
            JSON.stringify({ reconcile: 'modelUsage delta', deltaIn, deltaOut, modelIn, modelOut }),
            deltaOut, deltaIn, 0)
          inputTokens  = modelIn
          outputTokens = modelOut
        }
        // Persist authoritative cost on the session row. Analytics can query
        // either SUM(message.tokens) or session.cost_usd and both agree.
        database.sessionUpdate(db, sessionId, { cost_usd: costUsd })
      }
    }

    // Do NOT auto-publish the agent's final text as a ticket comment.
    // That used to duplicate the last assistant message (already visible
    // on the session page) and blurred the ticket view with conversation
    // artifacts. Agents post to the ticket explicitly via ticketComment
    // when they have something to communicate (e.g. "Merged PR #42").
    //
    // ticketComplete below writes one summary comment instead —
    // "Session complete · N tools · Nk tokens · $0.NN · Ns" — giving
    // the ticket a single compact closure line per session.

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
    const failSummary = summarizeSession(toolCallTotal, inputTokens, outputTokens, costUsd, Date.now() - startTime)
    const failNotes = failSummary ? `${msg}\n\n${failSummary}` : msg
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
