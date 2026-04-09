import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'

import { type Db } from '../database.js'
import database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef, type Comment } from '../schema.js'
import domain, { type TicketChainEntry } from '../domain.js'
import { now, slugify } from '../functional.js'

import { workspace, resolveModelWithDefaults } from './effect.js'
import { makeTools } from './tool.js'

// The result shape from one generateText call. Pulled via Awaited<ReturnType<>>
// so we don't have to spell out the full generic instantiation.
type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

export interface LoopStats {
  tokens_in:     number
  tokens_out:    number
  step_count:    number
  tool_calls:    number
  finish_reason: string | null
}

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(
  agentPrompt: string,
  agentMd:     string,
  chain:       TicketChainEntry[],
  ticketData:  Ticket,
): string {
  const chainText = chain.slice(0, -1)
    .map(t => `### ${t.title} (${t.status})\n${t.body}`)
    .join('\n\n')

  return [
    agentPrompt,
    '',
    '---',
    '',
    '## Project Context (AGENT.md)',
    '',
    agentMd,
    chainText ? `\n## Parent Tickets\n\n${chainText}` : '',
    '',
    '---',
    '',
    `## Current Ticket: ${ticketData.title}`,
    '',
    ticketData.body,
  ].filter(s => s !== undefined).join('\n')
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT
// ════════════════════════════════════════════════════════════════════════════
// Gather ticket chain + AGENT.md, build the system prompt, construct the
// tool set, persist the system prompt to the session row. One concern:
// everything the step loop needs that isn't the model.

async function buildContext(
  db:         Db,
  config:     Config,
  sessionId:  string,
  ticketData: Ticket,
  agentDef:   AgentDef,
  workDir:    string,
): Promise<{ system: string; tools: ReturnType<typeof makeTools> }> {
  const proj = database.project.get(db, ticketData.project_id)
  const slug = proj ? slugify(proj.name) : ''

  let chain: TicketChainEntry[] = []
  try { chain = domain.ticket.chain(db)(ticketData.id) } catch { /* empty chain */ }

  let agentMd = ''
  try {
    if (proj) agentMd = await domain.file.read(config.repoBase)(slug, 'AGENT.md')
  } catch { /* no AGENT.md */ }

  const system = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData)
  database.session.update(db, sessionId, { system_prompt: system })

  const enabledTools = agentDef.tools ? JSON.parse(agentDef.tools) as string[] : undefined
  const tools = makeTools(db, config, sessionId, ticketData.project_id, ticketData.id, agentDef.name, workDir, enabledTools)

  return { system, tools }
}

// ════════════════════════════════════════════════════════════════════════════
// COMMENT POLL
// ════════════════════════════════════════════════════════════════════════════
// Pure helpers that let runLoop track which comments have already been
// injected into the conversation. State (the "seen" Set<string>) lives
// in runLoop as a local so you can see where it comes from and where
// it gets mutated.

// Initial "seen" set: every comment that existed before the previous session
// ended. Ensures a reopen doesn't replay the full history, while letting any
// comment posted between sessions still count as fresh.
function seedSeenComments(db: Db, sessionId: string, ticketId: string): Set<string> {
  const priorSessions = database.session.byTicket(db, ticketId)
    .filter(s => s.id !== sessionId && s.ended_at)
  const cutoff = priorSessions.length > 0
    ? priorSessions[priorSessions.length - 1].ended_at!
    : null
  const allComments = database.comment.byTicket(db, ticketId)
  return new Set(
    cutoff
      ? allComments.filter(c => c.created_at <= cutoff).map(c => c.id)
      : allComments.map(c => c.id)
  )
}

// Comments posted by anyone other than the agent that haven't been injected yet.
function findFreshComments(db: Db, ticketId: string, agentName: string, seen: Set<string>): Comment[] {
  return database.comment.byTicket(db, ticketId)
    .filter(c => !seen.has(c.id) && c.author !== agentName)
}

// Format a list of comments as a single injected user message.
function formatInjectedMessage(comments: Comment[]): string {
  const text = comments.map(c => `[${c.author}]: ${c.body}`).join('\n\n')
  return `New feedback from founder:\n${text}`
}

// ════════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ════════════════════════════════════════════════════════════════════════════
// Write what happens during a session to the database. Split across two
// layers: persistStep runs after each generateText call; beginSession /
// completeSession / failSession bracket the whole run.

// Write one step's output. Reasoning, tool calls, and tool results go to
// session.message; assistant text goes to ticket.comment. Returns the new
// comment id (if any) so the caller can mark it seen in the poll set.
function persistStep(
  db:        Db,
  sessionId: string,
  ticketId:  string,
  agentName: string,
  result:    StepResult,
): string | null {
  const tokensIn  = result.usage?.inputTokens  ?? undefined
  const tokensOut = result.usage?.outputTokens ?? undefined

  if (result.reasoningText) {
    domain.session.message(db)(sessionId, 'reasoning', result.reasoningText)
  }

  let commentId: string | null = null
  if (result.text) {
    // Assistant text is the agent talking to the founder — goes to comments,
    // not session activity. Comments are the durable conversation; session
    // activity is the internal work log (tools + reasoning).
    const own = domain.comment.create(db)(ticketId, { author: agentName, body: result.text, session_id: sessionId })
    commentId = own.id
  }
  if (result.toolCalls?.length) {
    domain.session.message(db)(sessionId, 'assistant', JSON.stringify(result.toolCalls), tokensOut, tokensIn)
  }
  if (result.toolResults?.length) {
    domain.session.message(db)(sessionId, 'user', JSON.stringify(result.toolResults))
  }
  return commentId
}

function beginSession(db: Db, sessionId: string, ticketId: string, agentName: string, body: string): void {
  domain.comment.create(db)(ticketId, { author: agentName, body: 'Session started', session_id: sessionId })
  domain.session.message(db)(sessionId, 'user', body)
}

function completeSession(
  db:        Db,
  sessionId: string,
  ticketId:  string,
  agentName: string,
  stats:     LoopStats,
  startTime: number,
): void {
  domain.ticket.complete(db)(ticketId, { agentName, sessionId })
  database.session.update(db, sessionId, {
    status:        'done',
    ended_at:      now(),
    tokens_in:     stats.tokens_in  || null,
    tokens_out:    stats.tokens_out || null,
    duration_ms:   Date.now() - startTime,
    step_count:    stats.step_count || null,
    tool_calls:    stats.tool_calls || null,
    finish_reason: stats.finish_reason,
  })
}

function failSession(
  db:        Db,
  sessionId: string,
  ticketId:  string,
  agentName: string,
  err:       unknown,
  startTime: number,
): void {
  const msg = err instanceof Error ? err.message : String(err)
  try { domain.ticket.fail(db)(ticketId, { notes: msg, agentName, sessionId }) } catch { /* ticket may already be done */ }
  database.session.update(db, sessionId, {
    status:      'failed',
    error:       msg,
    ended_at:    now(),
    duration_ms: Date.now() - startTime,
  })
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════════════════════
// One step = one generateText call + persist + stats tally. The loop body
// is flat: inject any fresh comments, step, persist, repeat. Seen-set state
// is visible right in the function body.

async function runLoop(db: Db, args: {
  model:          LanguageModelV3
  system:         string
  tools:          ToolSet
  agentDef:       AgentDef
  sessionId:      string
  ticketId:       string
  agentName:      string
  initialMessage: string
}): Promise<LoopStats> {
  const { model, system, tools, agentDef, sessionId, ticketId, agentName, initialMessage } = args

  const seen: Set<string> = seedSeenComments(db, sessionId, ticketId)
  const messages: ModelMessage[] = [{ role: 'user', content: initialMessage }]
  const stats: LoopStats = {
    tokens_in: 0, tokens_out: 0, step_count: 0, tool_calls: 0, finish_reason: null,
  }

  for (let step = 0; step < agentDef.max_steps; step++) {
    // Inject any unseen non-agent comments as a user message
    const fresh = findFreshComments(db, ticketId, agentName, seen)
    if (fresh.length > 0) {
      const injected = formatInjectedMessage(fresh)
      messages.push({ role: 'user', content: injected })
      domain.session.message(db)(sessionId, 'user', injected)
      fresh.forEach(c => seen.add(c.id))
    }

    const result = await generateText({ model, system, messages, tools, stopWhen: stepCountIs(1) })

    const commentId = persistStep(db, sessionId, ticketId, agentName, result)
    if (commentId) seen.add(commentId)

    messages.push(...result.response.messages)

    stats.tokens_in    += result.usage?.inputTokens  ?? 0
    stats.tokens_out   += result.usage?.outputTokens ?? 0
    stats.tool_calls   += result.toolCalls?.length ?? 0
    stats.step_count   += 1
    stats.finish_reason = result.finishReason ?? null

    if (result.finishReason === 'stop') break
  }

  return stats
}

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════
// Wiring only. Each line is one concern: set up workspace, build context,
// kick off lifecycle, run loop, publish workspace, finalize — with a single
// try/catch/finally around it for state transitions and cleanup.

export async function runAgentSession(
  db:         Db,
  config:     Config,
  sessionId:  string,
  agentDef:   AgentDef,
  ticketData: Ticket,
): Promise<void> {
  const startTime = Date.now()
  const workDir   = await workspace.clone(db, config, ticketData.project_id).catch(() => workspace.empty())
  try {
    const { system, tools } = await buildContext(db, config, sessionId, ticketData, agentDef, workDir)
    beginSession(db, sessionId, ticketData.id, agentDef.name, ticketData.body)

    const model = resolveModelWithDefaults(db, agentDef)
    const stats = await runLoop(db, {
      model, system, tools, agentDef,
      sessionId,
      ticketId:       ticketData.id,
      agentName:      agentDef.name,
      initialMessage: ticketData.body,
    })

    // Push is best-effort: an agent run that completed its work shouldn't
    // be marked failed just because the bare repo rejected the push.
    try { await workspace.publish(workDir) } catch (err) {
      console.error(`session ${sessionId}: push failed:`, err)
    }

    completeSession(db, sessionId, ticketData.id, agentDef.name, stats, startTime)
  } catch (err) {
    failSession(db, sessionId, ticketData.id, agentDef.name, err, startTime)
  } finally {
    await workspace.destroy(workDir)
  }
}
