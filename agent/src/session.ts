import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import type { Db } from './db/client.js'
import { agentSessions, agentMessages } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { makeRunCommandTool } from './tools/run_command.js'
import { makeCreateTicketTool } from './tools/create_ticket.js'

interface Tool {
  name: string
  description: string
  params: z.ZodTypeAny
  execute: (args: unknown) => Promise<string>
}

interface SessionDeps {
  ticketUrl: string
  sandboxUrl: string
  filesUrl: string
}

interface TicketChainEntry {
  id: string
  title: string
  body: string
  notes: string | null
  agent: string
  status: string
}

interface TicketData {
  id: string
  project_id: string
  title: string
  body: string
  agent: string
  status: string
}

function buildSystemPrompt(
  agentPrompt: string,
  agentMd: string,
  chain: TicketChainEntry[],
  ticket: TicketData,
): string {
  const chainText = chain.slice(0, -1)  // exclude current ticket (shown separately)
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

export async function runAgentSession(
  db: Db,
  sessionId: string,
  agentDef: { id: string; project_id: string; name: string; prompt: string },
  ticket: TicketData,
  deps: SessionDeps,
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Fetch chain
  const chainRes = await fetch(`${deps.ticketUrl}/ticket/${ticket.id}/chain`)
  const chain: TicketChainEntry[] = chainRes.ok ? await chainRes.json() : []

  // Fetch AGENT.md — best effort
  let agentMd = ''
  try {
    const mdRes = await fetch(`${deps.filesUrl}/file/${agentDef.project_id}/AGENT.md`)
    if (mdRes.ok) agentMd = await mdRes.text()
  } catch {
    // not fatal
  }

  const systemPrompt = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticket)

  const tools: Tool[] = [
    makeRunCommandTool({
      sandboxUrl: deps.sandboxUrl,
      workspace: `/tmp/foundry-work-${sessionId}`,
      sessionId,
    }),
    makeCreateTicketTool({
      ticketUrl: deps.ticketUrl,
      projectId: agentDef.project_id,
      currentTicketId: ticket.id,
      agentName: agentDef.name,
    }),
  ]

  const sdkTools: Anthropic.Messages.Tool[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.params) as Anthropic.Messages.Tool['input_schema'],
  }))

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: ticket.body },
  ]

  function saveMessage(role: string, content: string) {
    db.insert(agentMessages).values({
      id: nanoid(),
      session_id: sessionId,
      role,
      content,
      created_at: new Date().toISOString(),
    }).run()
  }

  saveMessage('user', ticket.body)

  let notes = ''

  try {
    while (true) {
      const response = await client.messages.create({
        model: process.env.AGENT_MODEL ?? 'claude-opus-4-5',
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
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
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

    // Mark done
    await fetch(`${deps.ticketUrl}/ticket/${ticket.id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    })

    db.update(agentSessions)
      .set({ status: 'done', ended_at: new Date().toISOString() })
      .where(eq(agentSessions.id, sessionId))
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    await fetch(`${deps.ticketUrl}/ticket/${ticket.id}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: msg }),
    })

    db.update(agentSessions)
      .set({ status: 'failed', ended_at: new Date().toISOString() })
      .where(eq(agentSessions.id, sessionId))
      .run()
  }
}
