import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Db } from './database.js'
import type { Config } from './config.js'
import type { Ticket, Agent as AgentDef } from './schema.js'
import domain, { type TicketChainEntry } from './domain.js'
import { now, slugify } from './functional.js'
import { makeRunCommandTool, makeCreateTicketTool, type Tool } from './tool.js'

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
    const client = new Anthropic({ apiKey: config.anthropicKey })
    const startTime = Date.now()
    let totalTokensIn = 0
    let totalTokensOut = 0

    let chain: TicketChainEntry[] = []
    try { chain = domain.ticket.chain(db)(ticketData.id) } catch { /* empty chain */ }

    // Derive slug from project name for file access
    let agentMd = ''
    try {
      const proj = db.project.get(ticketData.project_id)
      if (proj) agentMd = await domain.file.read(config.repoBase)(slugify(proj.name), 'AGENT.md')
    } catch { /* no AGENT.md */ }

    const systemPrompt = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData)

    const tools: Tool[] = [
      makeRunCommandTool(db, config, sessionId),
      makeCreateTicketTool(db, ticketData.project_id, ticketData.id, agentDef.name),
    ]

    const sdkTools: Anthropic.Messages.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.params) as Anthropic.Messages.Tool['input_schema'],
    }))

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: ticketData.body },
    ]

    const saveMessage = (role: string, content: string, tokens?: number) =>
      db.message.insert({ session_id: sessionId, role, content, tokens: tokens ?? null, created_at: now() })

    saveMessage('user', ticketData.body)

    let notes = ''

    try {
      while (true) {
        const response = await client.messages.create({
          model: agentDef.model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: sdkTools,
          messages,
        })

        totalTokensIn  += response.usage?.input_tokens ?? 0
        totalTokensOut += response.usage?.output_tokens ?? 0

        const assistantText = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')

        saveMessage('assistant', JSON.stringify(response.content), response.usage?.output_tokens)
        messages.push({ role: 'assistant', content: response.content })

        if (response.stop_reason === 'end_turn') {
          notes = assistantText
          break
        }

        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        )

        if (toolUseBlocks.length === 0) {
          notes = assistantText
          break
        }

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
        for (const block of toolUseBlocks) {
          const tool = tools.find(t => t.name === block.name)
          const result = tool
            ? await tool.execute(block.input)
            : JSON.stringify({ error: `unknown tool: ${block.name}` })
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        }

        messages.push({ role: 'user', content: toolResults })
      }

      domain.ticket.complete(db)(ticketData.id, notes)
      db.session.update(sessionId, {
        status: 'done', ended_at: now(),
        tokens_in: totalTokensIn, tokens_out: totalTokensOut,
        duration_ms: Date.now() - startTime,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { domain.ticket.fail(db)(ticketData.id, msg) } catch { /* ticket may already be done */ }
      db.session.update(sessionId, {
        status: 'failed', error: msg, ended_at: now(),
        tokens_in: totalTokensIn, tokens_out: totalTokensOut,
        duration_ms: Date.now() - startTime,
      })
    }
  }
