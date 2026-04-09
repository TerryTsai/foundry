import { resolveModelWithDefaults } from './provider.js'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import domain, { type TicketChainEntry } from '../domain.js'
import { now, slugify } from '../functional.js'
import { makeTools } from './tool.js'
import workspace from './workspace.js'
import loop, { type LoopStats } from './loop.js'

// ── System prompt ──

const buildSystemPrompt = (
  agentPrompt: string,
  agentMd:     string,
  chain:       TicketChainEntry[],
  ticketData:  Ticket,
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

// ── Per-session context assembly ──
// Gather ticket chain + AGENT.md, build the system prompt, construct the tool
// set, persist the system prompt to the session row. One concern: everything
// the step loop needs that isn't the model.

const buildContext = (db: Db, config: Config) =>
  async (sessionId: string, ticketData: Ticket, agentDef: AgentDef, workDir: string) => {
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

// ── Session lifecycle (file-local) ──
// These three functions exist solely to keep runAgentSession linear.
// Not exported — they're not a public primitive, just the state transitions
// that bracket the step loop.

const lifecycle = {
  begin: (db: Db) => (sessionId: string, ticketId: string, agentName: string, body: string): void => {
    domain.comment.create(db)(ticketId, { author: agentName, body: 'Session started', session_id: sessionId })
    domain.session.message(db)(sessionId, 'user', body)
  },

  succeed: (db: Db) => (sessionId: string, ticketId: string, agentName: string, stats: LoopStats, startTime: number): void => {
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
  },

  fail: (db: Db) => (sessionId: string, ticketId: string, agentName: string, err: unknown, startTime: number): void => {
    const msg = err instanceof Error ? err.message : String(err)
    try { domain.ticket.fail(db)(ticketId, { notes: msg, agentName, sessionId }) } catch { /* ticket may already be done */ }
    database.session.update(db, sessionId, {
      status:      'failed',
      error:       msg,
      ended_at:    now(),
      duration_ms: Date.now() - startTime,
    })
  },
}

// ── Session runner ──
// Wiring only. Each line is one concern: set up workspace, build context,
// kick off lifecycle, run loop, publish workspace, finalize — with a single
// try/catch/finally around it for state transitions and cleanup.

export const runAgentSession = (db: Db, config: Config) =>
  async (sessionId: string, agentDef: AgentDef, ticketData: Ticket): Promise<void> => {
    const startTime = Date.now()
    const workDir   = await workspace.clone(db, config)(ticketData.project_id).catch(() => workspace.empty())
    try {
      const { system, tools } = await buildContext(db, config)(sessionId, ticketData, agentDef, workDir)
      lifecycle.begin(db)(sessionId, ticketData.id, agentDef.name, ticketData.body)

      const model = resolveModelWithDefaults(db)(agentDef)
      const stats = await loop.run(db)({
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

      lifecycle.succeed(db)(sessionId, ticketData.id, agentDef.name, stats, startTime)
    } catch (err) {
      lifecycle.fail(db)(sessionId, ticketData.id, agentDef.name, err, startTime)
    } finally {
      await workspace.destroy(workDir)
    }
  }
