import { generateText, stepCountIs } from 'ai'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveModel } from './provider.js'
import type { Db } from './database.js'
import type { Config } from './config.js'
import type { Ticket, Agent as AgentDef } from './schema.js'
import domain, { type TicketChainEntry } from './domain.js'
import { now, slugify } from './functional.js'
import { makeTools } from './tool.js'

const execFileAsync = promisify(execFile)

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

const cloneRepo = async (repoBase: string, slug: string): Promise<string> => {
  const workDir = await mkdtemp(join(tmpdir(), 'foundry-session-'))
  const bare = join(repoBase, `${slug}.git`)
  await execFileAsync('git', ['clone', bare, workDir])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
  await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Foundry'])
  return workDir
}

const pushRepo = async (workDir: string): Promise<void> => {
  // Stage and commit any changes the agent made
  await execFileAsync('git', ['-C', workDir, 'add', '-A'])
  try {
    await execFileAsync('git', ['-C', workDir, 'diff', '--cached', '--quiet'])
    // No changes to commit
  } catch {
    // There are staged changes — commit and push
    await execFileAsync('git', ['-C', workDir, 'commit', '-m', 'agent: apply changes'])
    const { stdout: branch } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branch.trim()}`])
  }
}

export const runAgentSession = (db: Db, config: Config) =>
  async (sessionId: string, agentDef: AgentDef, ticketData: Ticket): Promise<void> => {
    const startTime = Date.now()
    const proj = db.project.get(ticketData.project_id)
    const slug = proj ? slugify(proj.name) : ''

    // Clone project repo as shared workspace for this session
    let workDir: string | undefined
    try {
      workDir = await cloneRepo(config.repoBase, slug)
    } catch {
      // No repo yet — create an empty workspace
      workDir = await mkdtemp(join(tmpdir(), 'foundry-session-'))
    }

    try {
      let chain: TicketChainEntry[] = []
      try { chain = domain.ticket.chain(db)(ticketData.id) } catch { /* empty chain */ }

      let agentMd = ''
      try {
        if (proj) agentMd = await domain.file.read(config.repoBase)(slug, 'AGENT.md')
      } catch { /* no AGENT.md */ }

      const system = buildSystemPrompt(agentDef.prompt, agentMd, chain, ticketData)
      const tools = makeTools(db, config, sessionId, ticketData.project_id, ticketData.id, agentDef.name, workDir)

      // Log session start as a comment on the ticket
      domain.comment.create(db)(ticketData.id, { author: agentDef.name, body: 'Session started', session_id: sessionId })

      domain.session.message(db)(sessionId, 'user', ticketData.body)

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

      // Push any changes back to the bare repo
      try { await pushRepo(workDir) } catch (err) {
        console.error(`session ${sessionId}: push failed:`, err)
      }

      domain.ticket.complete(db)(ticketData.id, { ...(result.text ? { notes: result.text } : {}), agentName: agentDef.name, sessionId })
      db.session.update(sessionId, {
        status: 'done', ended_at: now(),
        tokens_in: result.usage?.inputTokens ?? null,
        tokens_out: result.usage?.outputTokens ?? null,
        duration_ms: Date.now() - startTime,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { domain.ticket.fail(db)(ticketData.id, { notes: msg, agentName: agentDef.name, sessionId }) } catch { /* ticket may already be done */ }
      db.session.update(sessionId, {
        status: 'failed', error: msg, ended_at: now(),
        duration_ms: Date.now() - startTime,
      })
    } finally {
      // Clean up workspace
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
