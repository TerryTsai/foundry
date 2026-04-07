import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, writeFile as fsWrite, mkdir } from 'fs/promises'
import { mkdirSync } from 'fs'
import type { Response } from 'express'
import type { Db } from './database.js'
import type { Config } from './config.js'
import type { Ticket, Comment, Project, Provider, Agent, Session, Message, Execution } from './schema.js'
import { require, assertStatus, slugify, pick, now, AppError, conflict, badRequest } from './functional.js'
import { supported } from './provider.js'
import { spawnRun, type RunHandle } from './runner.js'
import type { z } from 'zod'
import type * as v from './validate.js'

const execFileAsync = promisify(execFile)
const ts = () => { const t = now(); return { created_at: t, updated_at: t } }

// ── Tickets ──

export interface TicketChainEntry {
  id: string; title: string; body: string
  agent_id: string | null; status: string
}

export const ticket = {
  list: (db: Db) => (filters: z.infer<typeof v.ticket.list>): Ticket[] => {
    const { eq, isNull, col } = db
    const conditions = [
      filters.projectId ? eq(col.ticket.project_id, filters.projectId) : null,
      filters.agentId   ? eq(col.ticket.agent_id, filters.agentId)     : null,
      filters.status    ? eq(col.ticket.status, filters.status)         : null,
      filters.parentId === 'null' ? isNull(col.ticket.parent_id)
        : filters.parentId        ? eq(col.ticket.parent_id, filters.parentId) : null,
    ].filter(Boolean) as any[]
    return db.ticket.all(conditions)
  },

  get: (db: Db) => (id: string): Ticket =>
    require(db.ticket.get(id)),

  create: (db: Db) => (input: z.infer<typeof v.ticket.create>): Ticket => {
    const { project_id, agent_id, title, body, priority, parent_id, created_by, block } = input
    if (parent_id) require(db.ticket.get(parent_id), 'parent_id not found')

    return db.tx(tx => {
      const row = tx.ticket.insert({
        project_id, agent_id: agent_id ?? null, title, body, priority,
        status: 'open', parent_id: parent_id ?? null,
        created_by, ...ts(), claimed_at: null,
      })
      if (block && parent_id && tx.ticket.get(parent_id)?.status === 'claimed') {
        tx.ticket.update(parent_id, { status: 'blocked', updated_at: now() })
      }
      return row
    })
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.ticket.update>): Ticket => {
    require(db.ticket.get(id))
    return db.ticket.update(id, { ...pick(input, 'title', 'body', 'agent_id', 'priority'), updated_at: now() })
  },

  claim: (db: Db) => (id: string): Ticket =>
    db.tx(tx => {
      assertStatus(require(tx.ticket.get(id)), 'open')
      return tx.ticket.update(id, { status: 'claimed', claimed_at: now(), updated_at: now() })
    }),

  complete: (db: Db) => (id: string, notes?: string): Ticket =>
    db.tx(tx => {
      const row = assertStatus(require(tx.ticket.get(id)), 'claimed')
      tx.ticket.update(id, { status: 'done', updated_at: now() })
      if (notes) {
        tx.comment.insert({ ticket_id: id, author: 'system', body: notes, created_at: now() })
      }
      if (row.parent_id && tx.ticket.get(row.parent_id)?.status === 'blocked') {
        tx.ticket.update(row.parent_id, { status: 'open', updated_at: now() })
      }
      return require(tx.ticket.get(id))
    }),

  fail: (db: Db) => (id: string, notes?: string): Ticket => {
    assertStatus(require(db.ticket.get(id)), 'claimed')
    const row = db.ticket.update(id, { status: 'failed', updated_at: now() })
    if (notes) {
      db.comment.insert({ ticket_id: id, author: 'system', body: notes, created_at: now() })
    }
    return row
  },

  reopen: (db: Db) => (id: string): Ticket => {
    assertStatus(require(db.ticket.get(id)), 'failed')
    return db.ticket.update(id, { status: 'open', claimed_at: null, updated_at: now() })
  },

  chain: (db: Db) => (id: string): TicketChainEntry[] => {
    const chain: Ticket[] = []
    let current: Ticket | undefined = require(db.ticket.get(id))
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      chain.unshift(current)
      if (!current.parent_id) break
      current = db.ticket.get(current.parent_id)
    }
    return chain.map(t => ({
      id: t.id, title: t.title, body: t.body,
      agent_id: t.agent_id, status: t.status,
    }))
  },
}

// ── Comments ──

export const comment = {
  list: (db: Db) => (ticketId: string): Comment[] => {
    require(db.ticket.get(ticketId))
    return db.comment.byTicket(ticketId)
  },

  create: (db: Db) => (ticketId: string, input: z.infer<typeof v.comment.create>): Comment => {
    require(db.ticket.get(ticketId))
    return db.comment.insert({ ticket_id: ticketId, author: input.author, body: input.body, created_at: now() })
  },
}

// ── Projects ──

export const project = {
  list: (db: Db) => (filters: z.infer<typeof v.project.list>): Project[] => {
    const conditions = filters.status ? [db.eq(db.col.project.status, filters.status)] : []
    return db.project.all(conditions)
  },

  get: (db: Db) => (id: string): Project =>
    require(db.project.get(id)),

  create: (db: Db, config: Config) => async (input: z.infer<typeof v.project.create>): Promise<Project> => {
    const { name, schedule_interval = 600, concurrency_limit = 3 } = input
    const row = db.project.insert({
      name, status: 'active',
      schedule_interval, concurrency_limit, ...ts(),
    })
    // Init bare repo for project
    const bare = join(config.repoBase, `${slugify(name)}.git`)
    await execFileAsync('git', ['init', '--bare', bare])
    scheduler.start(db)(row.id, row.schedule_interval)
    return row
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.project.update>): Project => {
    const prev = require(db.project.get(id))
    const updates: Record<string, unknown> = {
      ...pick(input, 'name', 'status', 'schedule_interval', 'concurrency_limit'),
      updated_at: now(),
    }
    if (Object.keys(updates).length <= 1) return prev

    const row = db.project.update(id, updates)
    if (input.status === 'archived') scheduler.stop(id)
    if (input.status === 'active' && prev.status === 'archived') scheduler.start(db)(id, row.schedule_interval)
    if (input.schedule_interval !== undefined && row.status === 'active') scheduler.start(db)(id, row.schedule_interval)
    return row
  },

  run: (db: Db) => (id: string): { ok: true } => {
    const row = assertStatus(require(db.project.get(id)), 'active', 'project is not active')
    scheduler.dispatch(db)(row.id).catch((err: unknown) =>
      console.error(`dispatch error for project ${row.id}:`, err))
    return { ok: true }
  },
}

// ── Providers ──

const maskKey = (key: string): string => {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

export const provider = {
  list: (db: Db) => (): (Omit<Provider, 'api_key'> & { api_key_preview: string })[] =>
    db.provider.all().map(({ api_key, ...rest }) => ({ ...rest, api_key_preview: maskKey(api_key) })),

  create: (db: Db) => (input: z.infer<typeof v.provider.create>): Omit<Provider, 'api_key'> & { api_key_preview: string } => {
    if (!supported.includes(input.name)) throw badRequest(`unsupported provider '${input.name}' — supported: ${supported.join(', ')}`)
    if (db.provider.getByName(input.name)) throw conflict(`provider '${input.name}' already configured`)
    const { api_key, ...rest } = db.provider.insert({ name: input.name, api_key: input.api_key, ...ts() })
    return { ...rest, api_key_preview: maskKey(api_key) }
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.provider.update>): Omit<Provider, 'api_key'> & { api_key_preview: string } => {
    require(db.provider.get(id))
    const { api_key, ...rest } = db.provider.update(id, { api_key: input.api_key, updated_at: now() })
    return { ...rest, api_key_preview: maskKey(api_key) }
  },

  remove: (db: Db) => (id: string): { ok: true } => {
    require(db.provider.get(id))
    db.provider.remove(id)
    return { ok: true }
  },
}

// ── Agents ──

export const agent = {
  list: (db: Db) => (filters: z.infer<typeof v.agent.list>): Agent[] => {
    const conditions = filters.projectId ? [db.eq(db.col.agent.project_id, filters.projectId)] : []
    return db.agent.all(conditions)
  },

  get: (db: Db) => (id: string): Agent =>
    require(db.agent.get(id)),

  create: (db: Db) => (input: z.infer<typeof v.agent.create>): Agent => {
    const { project_id, name, model, prompt, max_tokens, max_steps, temperature } = input
    if (db.agent.all([db.eq(db.col.agent.project_id, project_id), db.eq(db.col.agent.name, name)]).length > 0) {
      throw conflict(`agent '${name}' already exists in project '${project_id}'`)
    }
    return db.agent.insert({
      project_id, name, model, prompt,
      max_tokens: max_tokens ?? 8192, max_steps: max_steps ?? 20,
      temperature: temperature ?? null, ...ts(),
    })
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.agent.update>): Agent => {
    require(db.agent.get(id))
    return db.agent.update(id, { ...pick(input, 'model', 'prompt', 'max_tokens', 'max_steps', 'temperature'), updated_at: now() })
  },

  remove: (db: Db) => (id: string): { ok: true } => {
    require(db.agent.get(id))
    db.agent.remove(id)
    return { ok: true }
  },
}

// ── Sessions ──

export const session = {
  get: (db: Db) => (id: string): Session =>
    require(db.session.get(id)),

  status: (db: Db) => (id: string): { status: string } =>
    ({ status: require(db.session.get(id)).status }),

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(db.session.get(id)), 'running', 'session is not running')
    db.session.update(id, { status: 'failed', error: 'killed', ended_at: now() })
    return { ok: true }
  },

  message: (db: Db) => (sessionId: string, role: string, content: string, tokens?: number): Message => {
    require(db.session.get(sessionId))
    return db.message.insert({
      session_id: sessionId, role, content,
      tokens: tokens ?? null, created_at: now(),
    })
  },

  messages: (db: Db) => (sessionId: string): Message[] => {
    require(db.session.get(sessionId))
    return db.message.bySession(sessionId)
  },

  byTicket: (db: Db) => (ticketId: string) => {
    require(db.ticket.get(ticketId))
    return db.session.byTicket(ticketId)
  },

  listAll: (db: Db) => () =>
    db.session.listWithAgent(),

  start: (db: Db, config: Config) => async (agentDefId: string, ticketId: string): Promise<Session> => {
    const agentDef = require(db.agent.get(agentDefId), 'agent not found')
    ticket.claim(db)(ticketId)
    const t = ticket.get(db)(ticketId)

    const row = db.session.insert({
      ticket_id: ticketId, agent_id: agentDefId,
      status: 'running', model: agentDef.model, started_at: now(),
    })

    const { runAgentSession } = await import('./agent.js')
    runAgentSession(db, config)(row.id, agentDef, t).catch((err: unknown) =>
      console.error(`session ${row.id} crashed:`, err))

    return row
  },
}

// ── Files ──

const gitExec = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

const bareDir = (repoBase: string, slug: string): string =>
  join(repoBase, `${slug}.git`)

export const file = {
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

// ── Execution ──

const activeRuns = new Map<string, RunHandle>()

export const execution = {
  list: (db: Db) => (): Execution[] =>
    db.execution.all().reverse().slice(0, 200),

  get: (db: Db) => (id: string): Execution =>
    require(db.execution.get(id)),

  bySession: (db: Db) => (sessionId: string): Execution[] => {
    require(db.session.get(sessionId))
    return db.execution.bySession(sessionId)
  },

  create: (db: Db, config: Config) =>
    (input: { command: string; session_id?: string | undefined; timeout_ms?: number | undefined; memory_mb?: number | undefined; network?: boolean | undefined; workspace?: string | undefined }) => {
      const { command, session_id, timeout_ms = config.sandboxTimeout, memory_mb, network = false } = input
      const row = db.execution.insert({
        session_id: session_id ?? null, command,
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
      activeRuns.set(row.id, handle)
      handle.emitter.on('exit', (code: number) => {
        db.execution.update(row.id, {
          status: code === 0 ? 'done' : 'failed',
          exit_code: code, ended_at: now(),
        })
        activeRuns.delete(row.id)
      })
      return { id: row.id, emitter: handle.emitter }
    },

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(db.execution.get(id)), 'running', 'execution is not active')
    const handle = activeRuns.get(id)
    if (handle) { handle.kill(); activeRuns.delete(id) }
    db.execution.update(id, { status: 'failed', exit_code: -1, ended_at: now() })
    return { ok: true }
  },

  stream: (db: Db) => (id: string, res: Response): void => {
    const row = require(db.execution.get(id))
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

// ── Scheduler ──

const intervals = new Map<string, ReturnType<typeof setInterval>>()

export const scheduler = {
  dispatch: (db: Db) => async (projectId: string): Promise<void> => {
    const proj = db.project.get(projectId)
    if (!proj || proj.status !== 'active') return

    const open    = ticket.list(db)({ projectId, status: 'open' })
    const claimed = ticket.list(db)({ projectId, status: 'claimed' })
    const agents  = agent.list(db)({ projectId })

    if (claimed.length >= proj.concurrency_limit) return

    for (const t of open.slice(0, proj.concurrency_limit - claimed.length)) {
      if (!t.agent_id) continue
      const def = agents.find(a => a.id === t.agent_id)
      if (!def) continue
      try { ticket.claim(db)(t.id) } catch { continue }

      const row = db.session.insert({
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
    for (const proj of db.project.all()) {
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
    for (const proj of db.project.all([db.eq(db.col.project.status, 'active')])) {
      scheduler.start(db)(proj.id, proj.schedule_interval)
    }
  },

  stopAll: (): void => {
    for (const [, timer] of intervals) clearInterval(timer)
    intervals.clear()
  },
}

// ── Barrel Export ──

export default { ticket, comment, project, provider, agent, session, file, execution, scheduler }
