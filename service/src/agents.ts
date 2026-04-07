import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Database } from './database.js'
import type { Config } from './config.js'
import type { Ticket, AgentDefinition } from './schema.js'
import { ticket, file, type TicketChainEntry } from './domain.js'
import { now } from './fn.js'
import { makeRunCommandTool, makeCreateTicketTool, type Tool } from './tools.js'

// ── System Prompt ──

export const buildSystemPrompt = (
  agentPrompt: string,
  agentMd: string,
  chain: TicketChainEntry[],
  ticketData: Ticket,
): string => {
  const chainText = chain.slice(0, -1)
    .map(t => `### ${t.title} (${t.status})\n${t.body}${t.notes ? `\n\nNotes: ${t.notes}` : ''}`)
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

export const runAgentSession = (db: Database, config: Config) =>
  async (sessionId: string, agentDef: AgentDefinition, ticketData: Ticket): Promise<void> => {
    const client = new Anthropic({ apiKey: config.anthropicKey })

    let chain: TicketChainEntry[] = []
    try { chain = ticket.chain(db)(ticketData.id) } catch { /* empty chain */ }

    let agentMd = ''
    try { agentMd = await file.read(config.repoBase)(agentDef.project_id, 'AGENT.md') } catch { /* no AGENT.md */ }

    const systemPrompt = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData)

    const tools: Tool[] = [
      makeRunCommandTool(db, config, sessionId),
      makeCreateTicketTool(db, agentDef.project_id, ticketData.id, agentDef.name),
    ]

    const sdkTools: Anthropic.Messages.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.params) as Anthropic.Messages.Tool['input_schema'],
    }))

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: ticketData.body },
    ]

    const saveMessage = (role: string, content: string) =>
      db.message.insert({ session_id: sessionId, role, content, created_at: now() })

    saveMessage('user', ticketData.body)

    let notes = ''

    try {
      while (true) {
        const response = await client.messages.create({
          model: config.agentModel,
          max_tokens: 8192,
          system: systemPrompt,
          tools: sdkTools,
          messages,
        })

        const assistantText = response.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')

        saveMessage('assistant', JSON.stringify(response.content))
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

      ticket.complete(db)(ticketData.id, notes)
      db.session.update(sessionId, { status: 'done', ended_at: now() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { ticket.fail(db)(ticketData.id, msg) } catch { /* ticket may already be done */ }
      db.session.update(sessionId, { status: 'failed', ended_at: now() })
    }
  }
