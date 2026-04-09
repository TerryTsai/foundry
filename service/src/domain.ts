import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, writeFile as fsWrite, mkdir } from 'fs/promises'
import { mkdirSync } from 'fs'
import type { Response } from 'express'
import type { Db } from './database.js'
import {
  project as projectDb, provider as providerDb,
  ticket as ticketDb, comment as commentDb,
  agent as agentDb, session as sessionDb, message as messageDb, execution as executionDb,
  eq, isNull,
} from './database.js'
import type { Config } from './config.js'
import type { Ticket, Comment, Project, Provider, Agent, Session, Message, Execution } from './schema.js'
import { require, assertStatus, slugify, pick, now, AppError, conflict, badRequest } from './functional.js'
import { supported } from './provider.js'
import { spawnRun, type RunHandle } from './runner.js'
import type { z } from 'zod'
import type * as v from './validate.js'

const execFileAsync = promisify(execFile)
const ts = () => { const t = now(); return { created_at: t, updated_at: t } }

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

const project = {
  list: (db: Db) => (filters: z.infer<typeof v.project.list>): Project[] => {
    const conditions = filters.status ? [eq(projectDb.col.status, filters.status)] : []
    return projectDb.all(db, conditions)
  },

  get: (db: Db) => (id: string): Project =>
    require(projectDb.get(db, id)),

  create: (db: Db, config: Config) => async (input: z.infer<typeof v.project.create>): Promise<Project> => {
    const { name, schedule_interval = 600, concurrency_limit = 3 } = input
    const row = projectDb.insert(db, {
      name, status: 'active',
      schedule_interval, concurrency_limit, ...ts(),
    })
    const bare = join(config.repoBase, `${slugify(name)}.git`)
    await execFileAsync('git', ['init', '--bare', bare])
    scheduler.start(db)(row.id, row.schedule_interval)
    return row
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.project.update>): Project => {
    const prev = require(projectDb.get(db, id))
    const updates: Record<string, unknown> = {
      ...pick(input, 'name', 'status', 'schedule_interval', 'concurrency_limit'),
      updated_at: now(),
    }
    if (Object.keys(updates).length <= 1) return prev

    const row = projectDb.update(db, id, updates)
    if (input.status === 'archived') scheduler.stop(id)
    if (input.status === 'active' && prev.status === 'archived') scheduler.start(db)(id, row.schedule_interval)
    if (input.schedule_interval !== undefined && row.status === 'active') scheduler.start(db)(id, row.schedule_interval)
    return row
  },

  run: (db: Db) => (id: string): { ok: true } => {
    const row = assertStatus(require(projectDb.get(db, id)), 'active', 'project is not active')
    scheduler.dispatch(db)(row.id).catch((err: unknown) =>
      console.error(`dispatch error for project ${row.id}:`, err))
    return { ok: true }
  },
}

const maskKey = (key: string): string => {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

const provider = {
  list: (db: Db) => (): (Omit<Provider, 'api_key'> & { api_key_preview: string })[] =>
    providerDb.all(db).map(({ api_key, ...rest }) => ({ ...rest, api_key_preview: maskKey(api_key) })),

  create: (db: Db) => (input: z.infer<typeof v.provider.create>): Omit<Provider, 'api_key'> & { api_key_preview: string } => {
    if (!supported.includes(input.name)) throw badRequest(`unsupported provider '${input.name}' — supported: ${supported.join(', ')}`)
    if (providerDb.getByName(db, input.name)) throw conflict(`provider '${input.name}' already configured`)
    const { api_key, ...rest } = providerDb.insert(db, { name: input.name, api_key: input.api_key, ...ts() })
    return { ...rest, api_key_preview: maskKey(api_key) }
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.provider.update>): Omit<Provider, 'api_key'> & { api_key_preview: string } => {
    require(providerDb.get(db, id))
    const { api_key, ...rest } = providerDb.update(db, id, { api_key: input.api_key, updated_at: now() })
    return { ...rest, api_key_preview: maskKey(api_key) }
  },

  remove: (db: Db) => (id: string): { ok: true } => {
    require(providerDb.get(db, id))
    providerDb.remove(db, id)
    return { ok: true }
  },
}

const intervals = new Map<string, ReturnType<typeof setInterval>>()

const scheduler = {
  dispatch: (db: Db) => async (projectId: string): Promise<void> => {
    const proj = projectDb.get(db, projectId)
    if (!proj || proj.status !== 'active') return

    const open    = ticket.list(db)({ projectId, status: 'open' })
    const claimed = ticket.list(db)({ projectId, status: 'claimed' })
    const agents  = agent.list(db)({ projectId })

    if (claimed.length >= proj.concurrency_limit) return

    const eligible = open.filter(t => t.agent_id && agents.find(a => a.id === t.agent_id))

    for (const t of eligible.slice(0, proj.concurrency_limit - claimed.length)) {
      const def = agents.find(a => a.id === t.agent_id)!
      try { ticket.claim(db)(t.id) } catch { continue }

      const row = sessionDb.insert(db, {
        ticket_id: t.id, agent_id: def.id,
        status: 'running', model: def.model, started_at: now(),
      })

      const { runAgentSession } = await import('./agent.js')
      const { config } = await import('./config.js')
      runAgentSession(db, config)(row.id, def, t).catch((err: unknown) =>
        console.error('dispatch session error:', err))
    }
  },

  recover: (db: Db) => async (): Promise<void> => {
    for (const proj of projectDb.all(db)) {
      const cutoff = new Date(Date.now() - proj.schedule_interval * 3 * 1000).toISOString()
      for (const t of ticket.list(db)({ projectId: proj.id, status: 'claimed' })) {
        if (t.claimed_at && t.claimed_at < cutoff) {
          try { ticket.reopen(db)(t.id) } catch { /* skip */ }
        }
      }
    }
  },

  start: (db: Db) => (projectId: string, intervalSeconds: number): void => {
    scheduler.stop(projectId)
    intervals.set(projectId, setInterval(
      () => scheduler.dispatch(db)(projectId).catch((err: unknown) =>
        console.error(`dispatch error for project ${projectId}:`, err)),
      intervalSeconds * 1000,
    ))
  },

  stop: (projectId: string): void => {
    const existing = intervals.get(projectId)
    if (existing) { clearInterval(existing); intervals.delete(projectId) }
  },

  startAll: (db: Db) => (): void => {
    for (const proj of projectDb.all(db, [eq(projectDb.col.status, 'active')])) {
      scheduler.start(db)(proj.id, proj.schedule_interval)
    }
  },

  stopAll: (): void => {
    for (const [, timer] of intervals) clearInterval(timer)
    intervals.clear()
  },
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

const ticket = {
  list: (db: Db) => (filters: z.infer<typeof v.ticket.list>): Ticket[] => {
    const conditions = [
      filters.projectId ? eq(ticketDb.col.project_id, filters.projectId) : null,
      filters.agentId   ? eq(ticketDb.col.agent_id, filters.agentId)     : null,
      filters.status    ? eq(ticketDb.col.status, filters.status)         : null,
      filters.parentId === 'null' ? isNull(ticketDb.col.parent_id)
        : filters.parentId        ? eq(ticketDb.col.parent_id, filters.parentId) : null,
    ].filter(Boolean) as any[]
    return ticketDb.all(db, conditions)
  },

  get: (db: Db) => (id: string): Ticket =>
    require(ticketDb.get(db, id)),

  create: (db: Db) => (input: z.infer<typeof v.ticket.create>): Ticket => {
    const { project_id, agent_id, title, body, priority, parent_id, created_by, block } = input
    if (parent_id) require(ticketDb.get(db, parent_id), 'parent_id not found')

    return db.transaction(tx => {
      const row = ticketDb.insert(tx as any, {
        project_id, agent_id: agent_id ?? null, title, body, priority,
        status: 'open', parent_id: parent_id ?? null,
        created_by, ...ts(), claimed_at: null,
      })
      if (block && parent_id && ticketDb.get(tx as any, parent_id)?.status === 'claimed') {
        ticketDb.update(tx as any, parent_id, { status: 'blocked', updated_at: now() })
      }
      return row
    }) as Ticket,
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.ticket.update>): Ticket => {
    require(ticketDb.get(db, id))
    return ticketDb.update(db, id, { ...pick(input, 'title', 'body', 'agent_id', 'priority'), updated_at: now() })
  },

  claim: (db: Db) => (id: string): Ticket =>
    db.transaction(tx => {
      assertStatus(require(ticketDb.get(tx as any, id)), 'open')
      return ticketDb.update(tx as any, id, { status: 'claimed', claimed_at: now(), updated_at: now() })
    }) as Ticket,

  complete: (db: Db) => (id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket =>
    db.transaction(tx => {
      const d = tx as any
      const row = assertStatus(require(ticketDb.get(d, id)), 'claimed')
      ticketDb.update(d, id, { status: 'done', updated_at: now() })
      const author = opts?.agentName ?? 'system'
      const body = opts?.notes ? `Session completed\n${opts.notes}` : 'Session completed'
      commentDb.insert(d, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
      if (row.parent_id && ticketDb.get(d, row.parent_id)?.status === 'blocked') {
        ticketDb.update(d, row.parent_id, { status: 'open', updated_at: now() })
      }
      return require(ticketDb.get(d, id))
    }) as Ticket,

  fail: (db: Db) => (id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket => {
    assertStatus(require(ticketDb.get(db, id)), 'claimed')
    const row = ticketDb.update(db, id, { status: 'failed', updated_at: now() })
    const author = opts?.agentName ?? 'system'
    const body = opts?.notes ? `Session failed\n${opts.notes}` : 'Session failed'
    commentDb.insert(db, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
    return row
  },

  reopen: (db: Db) => (id: string): Ticket => {
    assertStatus(require(ticketDb.get(db, id)), 'failed')
    return ticketDb.update(db, id, { status: 'open', claimed_at: null, updated_at: now() })
  },

  chain: (db: Db) => (id: string): TicketChainEntry[] => {
    const chain: Ticket[] = []
    let current: Ticket | undefined = require(ticketDb.get(db, id))
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      chain.unshift(current)
      if (!current.parent_id) break
      current = ticketDb.get(db, current.parent_id)
    }
    return chain.map(t => ({
      id: t.id, title: t.title, body: t.body,
      agent_id: t.agent_id, status: t.status,
    }))
  },
}

const comment = {
  list: (db: Db) => (ticketId: string): Comment[] => {
    require(ticketDb.get(db, ticketId))
    return commentDb.byTicket(db, ticketId)
  },

  create: (db: Db) => (ticketId: string, input: { author: string; body: string; session_id?: string }): Comment => {
    require(ticketDb.get(db, ticketId))
    return commentDb.insert(db, { ticket_id: ticketId, session_id: input.session_id ?? null, author: input.author, body: input.body, created_at: now() })
  },
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

const agent = {
  list: (db: Db) => (filters: z.infer<typeof v.agent.list>): Agent[] => {
    const conditions = filters.projectId ? [eq(agentDb.col.project_id, filters.projectId)] : []
    return agentDb.all(db, conditions)
  },

  get: (db: Db) => (id: string): Agent =>
    require(agentDb.get(db, id)),

  create: (db: Db) => (input: z.infer<typeof v.agent.create>): Agent => {
    const { project_id, name, model, prompt, max_tokens, max_steps, temperature, tools } = input
    if (agentDb.all(db, [eq(agentDb.col.project_id, project_id), eq(agentDb.col.name, name)]).length > 0) {
      throw conflict(`agent '${name}' already exists in project '${project_id}'`)
    }
    return agentDb.insert(db, {
      project_id, name, model, prompt,
      max_tokens: max_tokens ?? 8192, max_steps: max_steps ?? 20,
      temperature: temperature ?? null,
      tools: tools ? JSON.stringify(tools) : null,
      ...ts(),
    })
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.agent.update>): Agent => {
    require(agentDb.get(db, id))
    const data: Record<string, unknown> = { ...pick(input, 'model', 'prompt', 'max_tokens', 'max_steps', 'temperature'), updated_at: now() }
    if (input.tools !== undefined) data.tools = JSON.stringify(input.tools)
    return agentDb.update(db, id, data)
  },

  remove: (db: Db) => (id: string): { ok: true } => {
    require(agentDb.get(db, id))
    agentDb.remove(db, id)
    return { ok: true }
  },
}

const session = {
  get: (db: Db) => (id: string): Session =>
    require(sessionDb.get(db, id)),

  status: (db: Db) => (id: string): { status: string } =>
    ({ status: require(sessionDb.get(db, id)).status }),

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(sessionDb.get(db, id)), 'running', 'session is not running')
    sessionDb.update(db, id, { status: 'failed', error: 'killed', ended_at: now() })
    return { ok: true }
  },

  message: (db: Db) => (sessionId: string, role: string, content: string, tokens?: number, tokensIn?: number): Message => {
    require(sessionDb.get(db, sessionId))
    return messageDb.insert(db, {
      session_id: sessionId, role, content,
      tokens: tokens ?? null, tokens_in: tokensIn ?? null, created_at: now(),
    })
  },

  messages: (db: Db) => (sessionId: string): Message[] => {
    require(sessionDb.get(db, sessionId))
    return messageDb.bySession(db, sessionId)
  },

  byTicket: (db: Db) => (ticketId: string) => {
    require(ticketDb.get(db, ticketId))
    return sessionDb.byTicket(db, ticketId)
  },

  listAll: (db: Db) => () =>
    sessionDb.listWithAgent(db),

  start: (db: Db, config: Config) => async (agentDefId: string, ticketId: string): Promise<Session> => {
    const agentDef = require(agentDb.get(db, agentDefId), 'agent not found')
    ticket.claim(db)(ticketId)
    const t = ticket.get(db)(ticketId)

    const row = sessionDb.insert(db, {
      ticket_id: ticketId, agent_id: agentDefId,
      status: 'running', model: agentDef.model, started_at: now(),
    })

    const { runAgentSession } = await import('./agent.js')
    runAgentSession(db, config)(row.id, agentDef, t).catch((err: unknown) =>
      console.error(`session ${row.id} crashed:`, err))

    return row
  },
}

const activeRuns = new Map<string, RunHandle>()

const execution = {
  list: (db: Db) => (): Execution[] =>
    executionDb.all(db).reverse().slice(0, 200),

  get: (db: Db) => (id: string): Execution =>
    require(executionDb.get(db, id)),

  bySession: (db: Db) => (sessionId: string): Execution[] => {
    require(sessionDb.get(db, sessionId))
    return executionDb.bySession(db, sessionId)
  },

  create: (db: Db, config: Config) =>
    (input: { command: string; session_id?: string | undefined; tool_name?: string | undefined; timeout_ms?: number | undefined; memory_mb?: number | undefined; network?: boolean | undefined; workspace?: string | undefined }) => {
      const { command, session_id, tool_name, timeout_ms = config.sandboxTimeout, memory_mb, network = false } = input
      const row = executionDb.insert(db, {
        session_id: session_id ?? null, tool_name: tool_name ?? null, command,
        status: 'running', timeout_ms, memory_mb: memory_mb ?? null,
        started_at: now(),
      })
      const workspace = input.workspace ?? `/tmp/foundry-exec-${row.id}`
      mkdirSync(workspace, { recursive: true })
      const handle = spawnRun({
        command, workspace,
        image: config.sandboxImage, env: {},
        network, timeoutMs: timeout_ms,
      })
      const startTime = Date.now()
      activeRuns.set(row.id, handle)
      const stdoutBuf: string[] = []
      const stderrBuf: string[] = []
      handle.emitter.on('stdout', (line: string) => stdoutBuf.push(line))
      handle.emitter.on('stderr', (line: string) => stderrBuf.push(line))
      handle.emitter.on('exit', (code: number, stats: import('./runner.js').ContainerStats | null) => {
        executionDb.update(db, row.id, {
          status: code === 0 ? 'done' : 'failed',
          exit_code: code, ended_at: now(),
          duration_ms: Date.now() - startTime,
          stdout: stdoutBuf.join('\n') || null,
          stderr: stderrBuf.join('\n') || null,
          exit_signal: stats?.exitSignal ?? null,
          peak_memory_mb: stats?.peakMemoryMb ?? null,
          cpu_ms: stats?.cpuMs ?? null,
          net_rx_bytes: stats?.netRxBytes ?? null,
          net_tx_bytes: stats?.netTxBytes ?? null,
        })
        activeRuns.delete(row.id)
      })
      return { id: row.id, emitter: handle.emitter }
    },

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(executionDb.get(db, id)), 'running', 'execution is not active')
    const handle = activeRuns.get(id)
    if (handle) { handle.kill(); activeRuns.delete(id) }
    executionDb.update(db, id, { status: 'failed', exit_code: -1, ended_at: now() })
    return { ok: true }
  },

  stream: (db: Db) => (id: string, res: Response): void => {
    const row = require(executionDb.get(db, id))
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sse = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    if (row.status !== 'running') { sse('exit', { code: row.exit_code ?? -1 }); res.end(); return }

    const handle = activeRuns.get(id)
    if (!handle) { sse('exit', { code: -1 }); res.end(); return }

    const onStdout = (line: string) => sse('stdout', { line })
    const onStderr = (line: string) => sse('stderr', { line })
    const onExit   = (code: number) => { sse('exit', { code }); res.end() }

    handle.emitter.on('stdout', onStdout)
    handle.emitter.on('stderr', onStderr)
    handle.emitter.once('exit', onExit)
    res.on('close', () => {
      handle.emitter.off('stdout', onStdout)
      handle.emitter.off('stderr', onStderr)
      handle.emitter.off('exit', onExit)
    })
  },
}

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

const gitExec = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

const bareDir = (repoBase: string, slug: string): string =>
  join(repoBase, `${slug}.git`)

const file = {
  list: (repoBase: string) => async (slug: string): Promise<string[]> => {
    try {
      const out = await gitExec(['ls-tree', '-r', 'HEAD', '--name-only'], bareDir(repoBase, slug))
      return out.trim() ? out.trim().split('\n') : []
    } catch {
      throw new AppError(404, 'project not found or has no commits')
    }
  },

  read: (repoBase: string) => async (slug: string, path: string): Promise<string> => {
    try {
      return await gitExec(['show', `HEAD:${path}`], bareDir(repoBase, slug))
    } catch {
      throw new AppError(404, 'file not found')
    }
  },

  write: (repoBase: string) => async (slug: string, path: string, content: string, message: string): Promise<{ ok: true }> => {
    const workDir = await mkdtemp(join(tmpdir(), 'foundry-work-'))
    try {
      const bare = bareDir(repoBase, slug)
      await execFileAsync('git', ['clone', bare, workDir])
      await execFileAsync('git', ['-C', workDir, 'config', 'user.email', 'foundry@localhost'])
      await execFileAsync('git', ['-C', workDir, 'config', 'user.name', 'Foundry'])
      const target = join(workDir, path)
      await mkdir(dirname(target), { recursive: true })
      await fsWrite(target, content, 'utf8')
      await execFileAsync('git', ['-C', workDir, 'add', path])
      await execFileAsync('git', ['-C', workDir, 'commit', '-m', message, '--allow-empty'])
      const { stdout: branchOut } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--abbrev-ref', 'HEAD'])
      await execFileAsync('git', ['-C', workDir, 'push', 'origin', `HEAD:${branchOut.trim()}`])
      return { ok: true }
    } catch (err) {
      throw new AppError(500, err instanceof Error ? err.message : String(err))
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
}

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface TicketChainEntry {
  id: string; title: string; body: string
  agent_id: string | null; status: string
}

// ════════════════════════════════════════════════════════════════════════════

const domain = { ticket, comment, project, provider, agent, session, file, execution, scheduler }
export default domain
