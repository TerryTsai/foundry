import { generateText, stepCountIs } from 'ai'
import { resolveModel } from './provider.js'
import type { Db } from './database.js'
import type { Config } from './config.js'
import type { Ticket, Agent as AgentDef } from './schema.js'
import domain, { type TicketChainEntry } from './domain.js'
import { now, slugify } from './functional.js'
import { makeTools } from './tool.js'

// ── System Prompt ──

export const buildSystemPrompt = (
  agentPrompt: string,
  agentMd: string,
  chain: TicketChainEntry[],
  ticketData: Ticket,
): string => {
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

// ── Session Runner ──

export const runAgentSession = (db: Db, config: Config) =>
  async (sessionId: string, agentDef: AgentDef, ticketData: Ticket): Promise<void> => {
    const startTime = Date.now()

    let chain: TicketChainEntry[] = []
    try { chain = domain.ticket.chain(db)(ticketData.id) } catch { /* empty chain */ }

    let agentMd = ''
    try {
      const proj = db.project.get(ticketData.project_id)
      if (proj) agentMd = await domain.file.read(config.repoBase)(slugify(proj.name), 'AGENT.md')
    } catch { /* no AGENT.md */ }

    const system = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData)
    const tools = makeTools(db, config, sessionId, ticketData.project_id, ticketData.id, agentDef.name)

    // Save initial user message
    domain.session.message(db)(sessionId, 'user', ticketData.body)

    try {
      const result = await generateText({
        model: resolveModel(db)(agentDef.model),
        system,
        prompt: ticketData.body,
        tools,
        stopWhen: stepCountIs(agentDef.max_steps),
        maxOutputTokens: agentDef.max_tokens,
        ...(agentDef.temperature !== null ? { temperature: agentDef.temperature } : {}),
        onStepFinish: ({ text, toolCalls, toolResults, usage }) => {
          if (text) {
            domain.session.message(db)(sessionId, 'assistant', text, usage?.outputTokens ?? undefined)
          }
          if (toolCalls?.length) {
            domain.session.message(db)(sessionId, 'assistant', JSON.stringify(toolCalls), usage?.outputTokens ?? undefined)
          }
          if (toolResults?.length) {
            domain.session.message(db)(sessionId, 'user', JSON.stringify(toolResults))
          }
        },
      })

      domain.ticket.complete(db)(ticketData.id, result.text || undefined)
      db.session.update(sessionId, {
        status: 'done', ended_at: now(),
        tokens_in: result.usage?.inputTokens ?? null,
        tokens_out: result.usage?.outputTokens ?? null,
        duration_ms: Date.now() - startTime,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { domain.ticket.fail(db)(ticketData.id, msg) } catch { /* ticket may already be done */ }
      db.session.update(sessionId, {
        status: 'failed', error: msg, ended_at: now(),
        duration_ms: Date.now() - startTime,
      })
    }
  }
