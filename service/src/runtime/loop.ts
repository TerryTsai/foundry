import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Agent as AgentDef, Comment } from '../schema.js'
import domain from '../domain.js'

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

// ── Pure helpers (file-local) ──

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

// Write one step's output to the database. Reasoning, tool calls, and tool
// results go to session.message; assistant text goes to ticket.comment.
// Returns the new comment id (if any) so the caller can mark it seen.
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

// ── Loop ──

async function run(db: Db, args: {
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

export const loop = { run }
export default loop
