import { query } from '@anthropic-ai/claude-agent-sdk'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import * as domain from '../domain.js'
import { now, require } from '../functional.js'

import { workspaceClone, workspaceDestroy } from '../mcp/github.js'
import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'

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
// Publishing is fully agent-driven: the agent must call gitAdd → gitCommit →
// pullRequestCreate itself. The runner does not auto-publish at session end.
// If the agent finishes without publishing, the session branch never reaches
// GitHub and the workspace tmpdir is destroyed.

export async function runAgentSessionViaSdk(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  const conn = require(database.connectionGet(db, agentDef.connection_id), 'connection not found')
  const oauthToken = (() => {
    try {
      const secrets = JSON.parse(conn.secrets) as Record<string, unknown>
      // Legacy rows from the provider-era migration store the token under api_key.
      // New rows should use access_token. Accept either.
      const v = secrets.access_token ?? secrets.api_key
      if (typeof v !== 'string' || !v) throw new Error('missing access_token in connection secrets')
      return v
    } catch (err) {
      throw new Error(`connection '${conn.id}' secrets invalid: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()

  let workDir: string
  try {
    workDir = await workspaceClone(db, config, ticketData.project_id, sessionId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    try { domain.ticketFail(db, ticketData.id, { notes: msg, agentName: agentDef.name, sessionId }) } catch {}
    database.sessionUpdate(db, sessionId, {
      status: 'failed', error: msg, ended_at: now(), duration_ms: Date.now() - startTime,
    })
    return
  }

  // Inject the OAuth token. Single-process / single-subscription = no race.
  const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken

  try {
    domain.commentCreate(db, ticketData.id, { author: agentDef.name, body: 'Session started (SDK)', session_id: sessionId })
    const priorHistory = domain.ticketPriorHistory(db, ticketData.id, sessionId, agentDef.name)
    const prompt = priorHistory
      ? `${ticketData.body}\n\n---\n\n${priorHistory}`
      : ticketData.body
    domain.sessionMessage(db, sessionId, 'user', prompt)

    // Build the four in-process MCP servers. Each buildSdk returns a live
    // createSdkMcpServer ready to be passed to query().
    const foundryMcp = foundryServer.buildSdk({
      db, projectId: ticketData.project_id, ticketId: ticketData.id, agentName: agentDef.name,
    })
    const githubMcp  = githubServer.buildSdk({
      db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name,
    })
    const sandboxMcp = sandboxServer.buildSdk({ db, config, sessionId, workspace: workDir })
    const browserMcp = browserServer.buildSdk({ db, config, sessionId, workspace: workDir })

    let finalText    = ''
    let inputTokens  = 0
    let outputTokens = 0
    let stopReason: string | null = null
    let numTurns = 0

    for await (const message of query({
      prompt,
      options: {
        cwd:             workDir,
        tools:           [],          // disable all built-ins; only Foundry MCP tools
        mcpServers:      { foundry: foundryMcp, github: githubMcp, sandbox: sandboxMcp, browser: browserMcp },
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
