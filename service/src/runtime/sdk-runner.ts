import { query } from '@anthropic-ai/claude-agent-sdk'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import * as domain from '../domain.js'
import { now, require } from '../functional.js'

import { workspaceClone, workspacePublish, workspaceDestroy, type PublishResult } from './workspace.js'
import { makeSdkTools } from './tool.js'
import * as sandboxServer from '../mcp/sandbox.js'

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE AGENT SDK BACKEND
// ════════════════════════════════════════════════════════════════════════════
// Alternate runtime for agents whose provider.type is 'anthropic-subscription'.
// The SDK drives the agent loop and bills against a Claude Pro/Max subscription
// via CLAUDE_CODE_OAUTH_TOKEN (obtained once via `claude setup-token`). All
// tool calls still go through Foundry's MCP server (makeSdkTools) which routes
// to podman via runCommand → executionCreate → spawnRun. Built-in SDK tools
// are disabled via `tools: []` so the model can only use Foundry's sandboxed
// surface.
//
// Trade-offs vs the managed loop:
//   - No mid-session comment injection (SDK loop has no per-step pause)
//   - No per-step assistant message rows (one final message at end)
//   - No reasoning text as separate rows
// What's preserved:
//   - Workspace clone/publish + GitHub forwarding
//   - Per-execution rows in the execution table with full sandbox stats
//   - Subscription billing (zero API spend)

export async function runAgentSessionViaSdk(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  const provider = require(database.providerGet(db, agentDef.provider_id), 'provider not found')

  let workDir: string
  try {
    workDir = await workspaceClone(db, config, ticketData.project_id)
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
  process.env.CLAUDE_CODE_OAUTH_TOKEN = provider.api_key

  try {
    domain.commentCreate(db, ticketData.id, { author: agentDef.name, body: 'Session started (SDK)', session_id: sessionId })
    const priorHistory = domain.ticketPriorHistory(db, ticketData.id, sessionId, agentDef.name)
    const prompt = priorHistory
      ? `${ticketData.body}\n\n---\n\n${priorHistory}`
      : ticketData.body
    domain.sessionMessage(db, sessionId, 'user', prompt)

    const mcpServer = makeSdkTools(db, config, sessionId, ticketData.project_id, ticketData.id, agentDef.name, workDir)
    const sandboxMcp = sandboxServer.build(db, config, sessionId, workDir)

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
        mcpServers:      { foundry: mcpServer, sandbox: sandboxMcp },
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

    let pubResult: PublishResult | null = null
    try { pubResult = await workspacePublish(db, config, sessionId, ticketData, workDir) } catch (err) {
      console.error(`session ${sessionId}: publish failed:`, err)
    }
    if (pubResult) {
      domain.commentCreate(db, ticketData.id, {
        author:     agentDef.name,
        body:       `Draft PR opened: ${pubResult.prUrl}`,
        session_id: sessionId,
      })
    }

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
