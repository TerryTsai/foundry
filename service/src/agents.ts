import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Db } from './db.js'
import type { Config } from './config.js'
import type { Ticket, AgentDefinition } from './schema.js'
import { agentSessions, agentMessages } from './schema.js'
import { getTicketChain, gitReadFile, completeTicket, failTicket, type TicketChainEntry } from './helpers.js'
import { makeRunCommandTool, makeCreateTicketTool, type Tool } from './tools.js'

// ── System Prompt ──

export const buildSystemPrompt = (
  agentPrompt: string,
  agentMd: string,
  chain: TicketChainEntry[],
  ticket: Ticket,
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
    `## Current Ticket: ${ticket.title}`,
    '',
    ticket.body,
  ].filter(s => s !== undefined).join('\n')
}

// ── Session Runner ──

export const runAgentSession = (db: Db, config: Config) =>
  async (sessionId: string, agentDef: AgentDefinition, ticket: Ticket): Promise<void> => {
    const client = new Anthropic({ apiKey: config.anthropicKey })

    let chain: TicketChainEntry[] = []
    try { chain = getTicketChain(db)(ticket.id) } catch { /* empty chain */ }

    let agentMd = ''
    try { agentMd = await gitReadFile(config.repoBase)(agentDef.project_id, 'AGENT.md') } catch { /* no AGENT.md */ }

    const systemPrompt = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticket)

    const tools: Tool[] = [
      makeRunCommandTool(db, config, sessionId),
      makeCreateTicketTool(db, agentDef.project_id, ticket.id, agentDef.name),
    ]

    const sdkTools: Anthropic.Messages.Tool[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.params) as Anthropic.Messages.Tool['input_schema'],
    }))

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: ticket.body },
    ]

    const saveMessage = (role: string, content: string) => {
      db.insert(agentMessages).values({
        id: nanoid(), session_id: sessionId,
        role, content, created_at: new Date().toISOString(),
      }).run()
    }

    saveMessage('user', ticket.body)

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

      completeTicket(db)(ticket.id, notes)
      db.update(agentSessions)
        .set({ status: 'done', ended_at: new Date().toISOString() })
        .where(eq(agentSessions.id, sessionId)).run()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { failTicket(db)(ticket.id, msg) } catch { /* ticket may already be done */ }
      db.update(agentSessions)
        .set({ status: 'failed', ended_at: new Date().toISOString() })
        .where(eq(agentSessions.id, sessionId)).run()
    }
  }
