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
  const conn = require(database.connectionGet(db, agentDef.connection_id), 'connection not found')
  const oauthToken = resolveSubscriptionToken(db, conn)

  // Empty workspace — agent owns clone / bootstrap via gitClone tool.
  const workDir = await workspaceEmpty()

  // Inject the OAuth token. Single-process / single-subscription = no race.
  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

  try {
    domain.commentCreate(db, ticketData.id, { author: agentDef.name, body: 'Session started (SDK)', session_id: sessionId })
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

    let finalText    = ''
    let inputTokens  = 0
    let outputTokens = 0
    let stopReason: string | null = null
    let numTurns = 0

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
      if (message.type === 'result') {
        // result.usage is per-call (final turn only). result.modelUsage is
        // the cumulative-per-model totals across the whole agent run, which
        // is what we want for the session header. Sum across all models the
        // run touched, and include cache_read + cache_creation since those
        // are tokens the model actually processed (just billed differently).
        const models = Object.values(message.modelUsage)
        inputTokens  = models.reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
        outputTokens = models.reduce((s, m) => s + m.outputTokens, 0)
        numTurns     = message.num_turns
        stopReason   = message.stop_reason ?? message.subtype
        if (message.subtype === 'success') finalText = message.result
      }
    }

    // Persist a single assistant message with the final result + token totals.
    // Granular per-step rows aren't available because the SDK loop is opaque.
    domain.sessionMessage(db, sessionId, 'assistant', finalText || JSON.stringify({}), outputTokens, inputTokens, 0)
    if (finalText) {
      domain.commentCreate(db, ticketData.id, { author: agentDef.name, body: finalText, session_id: sessionId })
    }

    // No framework-level publish — the agent is responsible for calling
    // gitAdd → gitCommit → pullRequestCreate itself. If it didn't publish,
    // the session branch never leaves the tmpdir and is discarded on
    // workspaceDestroy below.

    domain.ticketComplete(db, ticketData.id, { agentName: agentDef.name, sessionId })
    database.sessionUpdate(db, sessionId, {
      status:        'done',
      ended_at:      now(),
      duration_ms:   Date.now() - startTime,
      finish_reason: stopReason ?? `sdk:${numTurns}-turns`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try { domain.ticketFail(db, ticketData.id, { notes: msg, agentName: agentDef.name, sessionId }) } catch {}
    database.sessionUpdate(db, sessionId, {
      status:      'failed',
      error:       msg,
      ended_at:    now(),
      duration_ms: Date.now() - startTime,
    })
  } finally {
    if (prevToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    await workspaceDestroy(workDir)
  }
}
