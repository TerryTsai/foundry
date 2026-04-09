import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Agent as AgentDef } from '../schema.js'
import domain from '../domain.js'

// The result shape from one generateText call. Pulled via Awaited<ReturnType<>>
// so we don't have to spell out the full generic instantiation.
type StepResult = Awaited<ReturnType<typeof generateText<ToolSet>>>

// ── Comment poller (file-local) ──
// Tracks which comments have already been injected into the conversation.
// Seeds itself on construction with comments from prior sessions so a
// reopen doesn't replay the full history — only feedback posted after
// the last session's end counts as fresh.

function commentPoller(db: Db, sessionId: string, ticketId: string, agentName: string) {
  const priorSessions = database.session.byTicket(db, ticketId)
    .filter(s => s.id !== sessionId && s.ended_at)
  const cutoff = priorSessions.length > 0
    ? priorSessions[priorSessions.length - 1].ended_at!
    : null
  const allComments = database.comment.byTicket(db, ticketId)
  const seen = new Set<string>(
    cutoff
      ? allComments.filter(c => c.created_at <= cutoff).map(c => c.id)
      : allComments.map(c => c.id)
  )

  return {
    // Returns an injected user message if there are unseen non-agent comments,
    // null otherwise. Persists the injection as a session message when fired.
    poll: (): ModelMessage | null => {
      const fresh = database.comment.byTicket(db, ticketId)
        .filter(c => !seen.has(c.id) && c.author !== agentName)
      if (fresh.length === 0) return null
      const text = fresh.map(c => `[${c.author}]: ${c.body}`).join('\n\n')
      fresh.forEach(c => seen.add(c.id))
      const injected = `New feedback from founder:\n${text}`
      domain.session.message(db)(sessionId, 'user', injected)
      return { role: 'user', content: injected }
    },
    // Mark a comment the loop just posted as seen, so it isn't re-injected.
    markSeen: (commentId: string): void => { seen.add(commentId) },
  }
}

// ── Step persistence (file-local) ──
// Writes the four kinds of output from one generateText call to the right
// tables: reasoning → session.message, assistant text → ticket.comment,
// tool calls/results → session.message. Returns the new comment id (if any)
// so the loop can mark it seen in the poller.

function persistStep(db: Db, sessionId: string, ticketId: string, agentName: string) {
  return (result: StepResult): { commentId: string | null } => {
    const tokensIn = result.usage?.inputTokens ?? undefined
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
    return { commentId }
  }
}

// ── Step loop ──

export interface LoopStats {
  tokens_in:     number
  tokens_out:    number
  step_count:    number
  tool_calls:    number
  finish_reason: string | null
}

const run = (db: Db) => async (args: {
  model:          LanguageModelV3
  system:         string
  tools:          ToolSet
  agentDef:       AgentDef
  sessionId:      string
  ticketId:       string
  agentName:      string
  initialMessage: string
}): Promise<LoopStats> => {
  const { model, system, tools, agentDef, sessionId, ticketId, agentName, initialMessage } = args
  const poller  = commentPoller(db, sessionId, ticketId, agentName)
  const persist = persistStep(db, sessionId, ticketId, agentName)
  const messages: ModelMessage[] = [{ role: 'user', content: initialMessage }]
  const stats: LoopStats = {
    tokens_in: 0, tokens_out: 0, step_count: 0, tool_calls: 0, finish_reason: null,
  }

  for (let step = 0; step < agentDef.max_steps; step++) {
    const injected = poller.poll()
    if (injected) messages.push(injected)

    const result = await generateText({ model, system, messages, tools, stopWhen: stepCountIs(1) })

    const { commentId } = persist(result)
    if (commentId) poller.markSeen(commentId)

    messages.push(...result.response.messages)

    stats.tokens_in    += result.usage?.inputTokens ?? 0
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
