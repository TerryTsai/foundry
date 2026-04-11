import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { readFile } from 'fs/promises'
import { join } from 'path'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef, type Comment } from '../schema.js'
import * as domain from '../domain.js'
import type { TicketChainEntry } from '../domain.js'
import { now } from '../functional.js'

import { workspaceClone, workspaceDestroy } from '../mcp/github.js'
import { resolveModelWithDefaults } from './model.js'
import * as foundryServer from '../mcp/foundry.js'
import * as githubServer  from '../mcp/github.js'
import * as sandboxServer from '../mcp/sandbox.js'
import * as browserServer from '../mcp/browser.js'

type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(agentPrompt: string, agentMd: string, chain: TicketChainEntry[], ticketData: Ticket, priorHistory: string): string {
  const chainText = chain.slice(0, -1)
    .map(t => `### ${t.title} (${t.status})\n${t.body}`)
    .join('\n\n')
  return [
    agentPrompt, '', '---', '',
    '## Project Context (AGENT.md)', '', agentMd,
    chainText ? `\n## Parent Tickets\n\n${chainText}` : '',
    '', '---', '',
    `## Current Ticket: ${ticketData.title}`, '', ticketData.body,
    priorHistory ? `\n\n---\n\n${priorHistory}` : '',
  ].filter(s => s !== undefined).join('\n')
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT
// ════════════════════════════════════════════════════════════════════════════

function readChain(db: Db, ticketId: string): TicketChainEntry[] {
  try { return domain.ticketChain(db, ticketId) } catch { return [] }
}

// AGENT.md lives at the root of the cloned workspace — it's a real checkout
// now, so plain fs.read instead of going through git internals.
async function readAgentMd(workDir: string): Promise<string> {
  try { return await readFile(join(workDir, 'AGENT.md'), 'utf-8') } catch { return '' }
}

async function buildContext(
  db: Db, config: Config, sessionId: string, ticketData: Ticket, agentDef: AgentDef, workDir: string,
): Promise<{ system: string; tools: ToolSet }> {
  const chain        = readChain(db, ticketData.id)
  const agentMd      = await readAgentMd(workDir)
  const priorHistory = domain.ticketPriorHistory(db, ticketData.id, sessionId, agentDef.name)
  const system       = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData, priorHistory)
  database.sessionUpdate(db, sessionId, { system_prompt: system })

  // Merge all four MCP server tool surfaces. Tool names are flat (no
  // mcp__<server>__<name> prefix) because the ai SDK doesn't namespace
  // them the way the Anthropic SDK does. Names are unique across servers
  // so collision isn't an issue.
  const tools: ToolSet = {
    ...foundryServer.buildAi({ db, projectId: ticketData.project_id, ticketId: ticketData.id, agentName: agentDef.name }),
    ...githubServer.buildAi({ db, config, sessionId, workspace: workDir, ticket: ticketData, agentName: agentDef.name }),
    ...sandboxServer.buildAi({ db, config, sessionId, workspace: workDir }),
    ...browserServer.buildAi({ db, config, sessionId, workspace: workDir }),
  }
  return { system, tools }
}

// ════════════════════════════════════════════════════════════════════════════
// COMMENT POLL
// ════════════════════════════════════════════════════════════════════════════

// Seed with everything older than the previous session's end so a reopen
// doesn't replay history, but feedback posted between sessions still fires.
function seedSeenComments(db: Db, sessionId: string, ticketId: string): Set<string> {
  const priorSessions = database.sessionByTicket(db, ticketId)
    .filter(s => s.id !== sessionId && s.ended_at)
  const cutoff = priorSessions[priorSessions.length - 1]?.ended_at ?? null
  const allComments = database.commentByTicket(db, ticketId)
  const filtered = cutoff ? allComments.filter(c => c.created_at <= cutoff) : allComments
  return new Set(filtered.map(c => c.id))
}

function findFreshComments(db: Db, ticketId: string, agentName: string, seen: Set<string>): Comment[] {
  return database.commentByTicket(db, ticketId)
    .filter(c => !seen.has(c.id) && c.author !== agentName)
}

function formatInjectedMessage(comments: Comment[]): string {
  const text = comments.map(c => `[${c.author}]: ${c.body}`).join('\n\n')
  return `New feedback from founder:\n${text}`
}

// ════════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ════════════════════════════════════════════════════════════════════════════

// Assistant text goes to ticket.comment (durable conversation). Reasoning
// and tool calls/results go to session.message (internal work log). The
// assistant message is always written even when there are no tool calls,
// so per-step tokens always have a home for aggregation at read time.
function persistStep(db: Db, sessionId: string, ticketId: string, agentName: string, result: StepResult): string | null {
  const { inputTokens: tIn, outputTokens: tOut } = result.usage ?? {}
  const toolCallCount = result.toolCalls?.length ?? 0
  if (result.reasoningText)       domain.sessionMessage(db, sessionId, 'reasoning', result.reasoningText)
  domain.sessionMessage(db, sessionId, 'assistant', JSON.stringify(result.toolCalls ?? []), tOut, tIn, toolCallCount)
  if (result.toolResults?.length) domain.sessionMessage(db, sessionId, 'user', JSON.stringify(result.toolResults))
  if (!result.text) return null
  return domain.commentCreate(db, ticketId, { author: agentName, body: result.text, session_id: sessionId }).id
}

function beginSession(db: Db, sessionId: string, ticketId: string, agentName: string, body: string): void {
  domain.commentCreate(db, ticketId, { author: agentName, body: 'Session started', session_id: sessionId })
  domain.sessionMessage(db, sessionId, 'user', body)
}

function completeSession(db: Db, sessionId: string, ticketId: string, agentName: string, finishReason: string | null, startTime: number): void {
  domain.ticketComplete(db, ticketId, { agentName, sessionId })
  database.sessionUpdate(db, sessionId, {
    status: 'done', ended_at: now(), duration_ms: Date.now() - startTime,
    finish_reason: finishReason,
  })
}

function failSession(db: Db, sessionId: string, ticketId: string, agentName: string, err: unknown, startTime: number): void {
  const msg = err instanceof Error ? err.message : String(err)
  try { domain.ticketFail(db, ticketId, { notes: msg, agentName, sessionId }) } catch {}
  database.sessionUpdate(db, sessionId, {
    status: 'failed', error: msg, ended_at: now(), duration_ms: Date.now() - startTime,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════════════════════

async function runLoop(db: Db, args: {
  model: LanguageModelV3, system: string, tools: ToolSet, agentDef: AgentDef,
  sessionId: string, ticketId: string, agentName: string, initialMessage: string,
}): Promise<string | null> {
  const { model, system, tools, agentDef, sessionId, ticketId, agentName, initialMessage } = args
  const seen: Set<string>        = seedSeenComments(db, sessionId, ticketId)
  const messages: ModelMessage[] = [{ role: 'user', content: initialMessage }]
  let finishReason: string | null = null

  for (let step = 0; step < agentDef.max_steps; step++) {
    const fresh = findFreshComments(db, ticketId, agentName, seen)
    if (fresh.length > 0) {
      const injected = formatInjectedMessage(fresh)
      messages.push({ role: 'user', content: injected })
      domain.sessionMessage(db, sessionId, 'user', injected)
      fresh.forEach(c => seen.add(c.id))
    }
    const result = await generateText({ model, system, messages, tools, stopWhen: stepCountIs(1) })
    const commentId = persistStep(db, sessionId, ticketId, agentName, result)
    if (commentId) seen.add(commentId)
    messages.push(...result.response.messages)
    finishReason = result.finishReason ?? null
    if (finishReason === 'stop') break
  }
  return finishReason
}

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════

export async function runAgentSession(
  db: Db, config: Config, sessionId: string, agentDef: AgentDef, ticketData: Ticket,
): Promise<void> {
  // Backend dispatch: 'anthropic-subscription' connections route to the Claude
  // Agent SDK runner. Everything else uses the managed ai-SDK loop below.
  const conn = database.connectionGet(db, agentDef.connection_id)
  if (conn?.kind === 'anthropic-subscription') {
    const { runAgentSessionViaSdk } = await import('./sdk-runner.js')
    return runAgentSessionViaSdk(db, config, sessionId, agentDef, ticketData)
  }

  const startTime = Date.now()
  // Surface clone failures as session errors instead of dropping the agent
  // into an empty tmpdir. The previous fallback hid real problems (bad
  // installation token, app not installed on the repo, network) by letting
  // the agent run against an empty /work and produce nothing.
  let workDir: string
  try {
    workDir = await workspaceClone(db, config, ticketData.project_id, sessionId)
  } catch (err) {
    failSession(db, sessionId, ticketData.id, agentDef.name, err, startTime)
    return
  }
  try {
    const { system, tools } = await buildContext(db, config, sessionId, ticketData, agentDef, workDir)
    beginSession(db, sessionId, ticketData.id, agentDef.name, ticketData.body)
    const model = resolveModelWithDefaults(db, agentDef)
    const finishReason = await runLoop(db, {
      model, system, tools, agentDef, sessionId,
      ticketId: ticketData.id, agentName: agentDef.name, initialMessage: ticketData.body,
    })
    // No framework-level publish — the agent owns gitAdd → gitCommit →
    // pullRequestCreate via the github MCP tools. Sessions that finish
    // without publishing discard their workspace.
    completeSession(db, sessionId, ticketData.id, agentDef.name, finishReason, startTime)
  } catch (err) {
    failSession(db, sessionId, ticketData.id, agentDef.name, err, startTime)
  } finally {
    await workspaceDestroy(workDir)
  }
}
