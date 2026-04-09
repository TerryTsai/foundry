import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveModel } from './provider.js'
import { type Db } from '../database.js'
import database from '../database.js'
import type { Config } from '../config.js'
import { type Ticket, type Agent as AgentDef } from '../schema.js'
import domain, { type TicketChainEntry } from '../domain.js'
import { now, slugify } from '../functional.js'
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
    const proj = database.project.get(db,ticketData.project_id)
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
      database.session.update(db,sessionId, { system_prompt: system })
      const enabledTools = agentDef.tools ? JSON.parse(agentDef.tools) as string[] : undefined
      const tools = makeTools(db, config, sessionId, ticketData.project_id, ticketData.id, agentDef.name, workDir, enabledTools)

      // Log session start as a comment on the ticket
      domain.comment.create(db)(ticketData.id, { author: agentDef.name, body: 'Session started', session_id: sessionId })

      domain.session.message(db)(sessionId, 'user', ticketData.body)

      // Manual step loop — gives us injection points between steps for
      // mid-session course correction (new comments), budgets, hard kill, etc.

      const model = resolveModel(db)(agentDef.model)
      const messages: ModelMessage[] = [{ role: 'user', content: ticketData.body }]

      // Track comment IDs we've already seen so we don't re-inject them.
      // Pre-seed with comments older than the previous session's end (so prior
      // history is excluded but feedback posted between sessions still counts
      // as fresh on a reopen). For first sessions, only seed comments older
      // than the just-inserted "Session started" marker, which by author
      // filter is harmless but kept for clarity.
      const allComments = database.comment.byTicket(db, ticketData.id)
      const priorSessions = database.session.byTicket(db, ticketData.id)
        .filter(s => s.id !== sessionId && s.ended_at)
      const cutoff = priorSessions.length > 0
        ? priorSessions[priorSessions.length - 1].ended_at!
        : null
      const seenCommentIds = new Set<string>(
        cutoff
          ? allComments.filter(c => c.created_at <= cutoff).map(c => c.id)
          : allComments.map(c => c.id)
      )

      let totalTokensIn = 0
      let totalTokensOut = 0
      let totalToolCalls = 0
      let totalSteps = 0
      let lastFinishReason: string | null = null

      for (let step = 0; step < agentDef.max_steps; step++) {
        // Inject any unseen comments from anyone except the agent itself
        const newComments = database.comment.byTicket(db, ticketData.id)
          .filter(c => !seenCommentIds.has(c.id) && c.author !== agentDef.name)
        if (newComments.length > 0) {
          const text = newComments.map(c => `[${c.author}]: ${c.body}`).join('\n\n')
          const injected = `New feedback from founder:\n${text}`
          messages.push({ role: 'user', content: injected })
          domain.session.message(db)(sessionId, 'user', injected)
          newComments.forEach(c => seenCommentIds.add(c.id))
        }

        const result = await generateText({
          model, system, messages, tools,
          stopWhen: stepCountIs(1),
          maxOutputTokens: agentDef.max_tokens,
          ...(agentDef.temperature !== null ? { temperature: agentDef.temperature } : {}),
          ...(agentDef.reasoning_budget !== null ? {
            providerOptions: {
              anthropic: { thinking: { type: 'enabled', budgetTokens: agentDef.reasoning_budget } },
            },
          } : {}),
        })

        // Persist what happened in this step
        const tokensIn = result.usage?.inputTokens ?? undefined
        const tokensOut = result.usage?.outputTokens ?? undefined
        if (result.reasoningText) {
          domain.session.message(db)(sessionId, 'reasoning', result.reasoningText)
        }
        if (result.text) {
          // Assistant text is the agent talking to the founder — goes to comments,
          // not session activity. Comments are the durable conversation; session
          // activity is the internal work log (tools + reasoning).
          const own = domain.comment.create(db)(ticketData.id, { author: agentDef.name, body: result.text, session_id: sessionId })
          seenCommentIds.add(own.id)
        }
        if (result.toolCalls?.length) {
          domain.session.message(db)(sessionId, 'assistant', JSON.stringify(result.toolCalls), tokensOut, tokensIn)
        }
        if (result.toolResults?.length) {
          domain.session.message(db)(sessionId, 'user', JSON.stringify(result.toolResults))
        }

        // Append the SDK's response messages to our running history so the
        // next iteration sees the full conversation.
        messages.push(...result.response.messages)

        // Tally aggregates
        totalTokensIn += tokensIn ?? 0
        totalTokensOut += tokensOut ?? 0
        totalToolCalls += result.toolCalls?.length ?? 0
        totalSteps += 1
        lastFinishReason = result.finishReason ?? null

        // Stop if model is done
        if (result.finishReason === 'stop') break
      }

      // Push any changes back to the bare repo
      try { await pushRepo(workDir) } catch (err) {
        console.error(`session ${sessionId}: push failed:`, err)
      }

      domain.ticket.complete(db)(ticketData.id, { agentName: agentDef.name, sessionId })
      database.session.update(db, sessionId, {
        status: 'done', ended_at: now(),
        tokens_in: totalTokensIn || null,
        tokens_out: totalTokensOut || null,
        duration_ms: Date.now() - startTime,
        step_count: totalSteps || null,
        tool_calls: totalToolCalls || null,
        finish_reason: lastFinishReason,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try { domain.ticket.fail(db)(ticketData.id, { notes: msg, agentName: agentDef.name, sessionId }) } catch { /* ticket may already be done */ }
      database.session.update(db,sessionId, {
        status: 'failed', error: msg, ended_at: now(),
        duration_ms: Date.now() - startTime,
      })
    } finally {
      // Clean up workspace
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
