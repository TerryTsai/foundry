import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, writeFile as fsWrite, mkdir } from 'fs/promises'
import type { Response } from 'express'
import type { Database } from './database.js'
import type { Config } from './config.js'
import type { Ticket, Project, AgentDefinition, AgentSession, AgentMessage, SandboxRun } from './schema.js'
import { require, assertStatus, slugify, pick, now, AppError, notFound, conflict } from './fn.js'
import { spawnRun, type RunHandle } from './runner.js'
import type { z } from 'zod'
import type * as v from './validate.js'

const execFileAsync = promisify(execFile)

// ── Tickets ──

export interface TicketChainEntry {
  id: string; title: string; body: string
  notes: string | null; agent: string; status: string
}

export const ticket = {
  list: (db: Database) => (filters: z.infer<typeof v.ticket.list>): Ticket[] => {
    const { eq, isNull, col } = db
    const conditions = [
      filters.projectId ? eq(col.ticket.project_id, filters.projectId) : null,
      filters.agent     ? eq(col.ticket.agent, filters.agent)           : null,
      filters.status    ? eq(col.ticket.status, filters.status)         : null,
      filters.parentId === 'null' ? isNull(col.ticket.parent_id)
        : filters.parentId        ? eq(col.ticket.parent_id, filters.parentId) : null,
    ].filter(Boolean) as any[]
    return db.ticket.all(conditions)
  },

  get: (db: Database) => (id: string): Ticket =>
    require(db.ticket.get(id)),

  create: (db: Database) => (input: z.infer<typeof v.ticket.create>): Ticket => {
    const { project_id, title, body, agent, parent_id, created_by, block } = input
    if (parent_id) require(db.ticket.get(parent_id), 'parent_id not found')

    return db.tx(tx => {
      const row = tx.ticket.insert({
        project_id, title, body, agent, status: 'open',
        parent_id: parent_id ?? null, created_by, created_at: now(),
      })
      if (block && parent_id && tx.ticket.get(parent_id)?.status === 'claimed') {
        tx.ticket.update(parent_id, { status: 'blocked' })
      }
      return row
    })
  },

  update: (db: Database) => (id: string, input: z.infer<typeof v.ticket.update>): Ticket => {
    require(db.ticket.get(id))
    return db.ticket.update(id, pick(input, 'body', 'notes'))
  },

  claim: (db: Database) => (id: string): Ticket =>
    db.tx(tx => {
      assertStatus(require(tx.ticket.get(id)), 'open')
      return tx.ticket.update(id, { status: 'claimed', claimed_at: now() })
    }),

  complete: (db: Database) => (id: string, notes?: string): Ticket =>
    db.tx(tx => {
      const row = assertStatus(require(tx.ticket.get(id)), 'claimed')
      tx.ticket.update(id, { status: 'done', ...(notes !== undefined ? { notes } : {}) })
      if (row.parent_id && tx.ticket.get(row.parent_id)?.status === 'blocked') {
        tx.ticket.update(row.parent_id, { status: 'open' })
      }
      return require(tx.ticket.get(id))
    }),

  fail: (db: Database) => (id: string, notes?: string): Ticket => {
    assertStatus(require(db.ticket.get(id)), 'claimed')
    return db.ticket.update(id, { status: 'failed', ...(notes !== undefined ? { notes } : {}) })
  },

  reopen: (db: Database) => (id: string): Ticket => {
    assertStatus(require(db.ticket.get(id)), 'failed')
    return db.ticket.update(id, { status: 'open', claimed_at: null })
  },

  chain: (db: Database) => (id: string): TicketChainEntry[] => {
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
      notes: t.notes, agent: t.agent, status: t.status,
    }))
  },
}

// ── Projects ──

export const project = {
  list: (db: Database) => (filters: z.infer<typeof v.project.list>): Project[] => {
    const conditions = filters.status ? [db.eq(db.col.project.status, filters.status)] : []
    return db.project.all(conditions)
  },

  get: (db: Database) => (id: string): Project =>
    require(db.project.get(id)),

  create: (db: Database) => (input: z.infer<typeof v.project.create>): Project => {
    const { name, workspace, schedule_interval = 600, concurrency_limit = 3 } = input
    const slug = slugify(name)
    if (db.project.all([db.eq(db.col.project.slug, slug)]).length > 0) {
      throw conflict(`slug '${slug}' already exists`)
    }
    const row = db.project.insert({
      name, slug, status: 'active', workspace,
      schedule_interval, concurrency_limit, created_at: now(),
    })
    scheduler.start(db)(row.id, row.schedule_interval)
    return row
  },

  update: (db: Database) => (id: string, input: z.infer<typeof v.project.update>): Project => {
    const prev = require(db.project.get(id))
    const updates: Record<string, unknown> = {
      ...pick(input, 'workspace', 'status', 'schedule_interval', 'concurrency_limit'),
    }
    if (input.name !== undefined) { updates.name = input.name; updates.slug = slugify(input.name) }
    if (Object.keys(updates).length === 0) return prev

    const row = db.project.update(id, updates)
    if (input.status === 'paused') scheduler.stop(id)
    if (input.status === 'active' && prev.status === 'paused') scheduler.start(db)(id, row.schedule_interval)
    if (input.schedule_interval !== undefined && row.status === 'active') scheduler.start(db)(id, row.schedule_interval)
    return row
  },

  run: (db: Database) => (id: string): { ok: true } => {
    const row = assertStatus(require(db.project.get(id)), 'active', 'project is paused')
    scheduler.dispatch(db)(row.id).catch((err: unknown) =>
      console.error(`dispatch error for project ${row.id}:`, err))
    return { ok: true }
  },
}

// ── Agent Definitions ──

export const agent = {
  list: (db: Database) => (filters: z.infer<typeof v.agent.list>): AgentDefinition[] => {
    const conditions = filters.projectId ? [db.eq(db.col.agent.project_id, filters.projectId)] : []
    return db.agent.all(conditions)
  },

  get: (db: Database) => (id: string): AgentDefinition =>
    require(db.agent.get(id)),

  create: (db: Database) => (input: z.infer<typeof v.agent.create>): AgentDefinition => {
    const { project_id, name, prompt } = input
    if (db.agent.all([db.eq(db.col.agent.project_id, project_id), db.eq(db.col.agent.name, name)]).length > 0) {
      throw conflict(`agent '${name}' already exists in project '${project_id}'`)
    }
    return db.agent.insert({
      project_id, name, prompt,
      image: 'node:20-alpine', env: '[]', created_at: now(),
    })
  },

  update: (db: Database) => (id: string, input: z.infer<typeof v.agent.update>): AgentDefinition => {
    require(db.agent.get(id))
    return db.agent.update(id, pick(input, 'prompt'))
  },

  remove: (db: Database) => (id: string): { ok: true } => {
    require(db.agent.get(id))
    db.agent.remove(id)
    return { ok: true }
  },
}

// ── Sessions ──

export const session = {
  get: (db: Database) => (id: string): AgentSession =>
    require(db.session.get(id)),

  status: (db: Database) => (id: string): { status: string } =>
    ({ status: require(db.session.get(id)).status }),

  kill: (db: Database) => (id: string): { ok: true } => {
    assertStatus(require(db.session.get(id)), 'running', 'session is not running')
    db.session.update(id, { status: 'failed', ended_at: now() })
    return { ok: true }
  },

  message: (db: Database) => (sessionId: string, role: string, content: string): AgentMessage => {
    require(db.session.get(sessionId))
    return db.message.insert({ session_id: sessionId, role, content, created_at: now() })
  },

  messages: (db: Database) => (sessionId: string): AgentMessage[] => {
    require(db.session.get(sessionId))
    return db.message.bySession(sessionId)
  },

  listAll: (db: Database) => () =>
    db.session.listWithAgent(),

  start: (db: Database, config: Config) => async (agentDefId: string, ticketId: string): Promise<AgentSession> => {
    require(db.agent.get(agentDefId), 'agent definition not found')
    ticket.claim(db)(ticketId)
    const t = ticket.get(db)(ticketId)

    const row = db.session.insert({
      ticket_id: ticketId, agent_def_id: agentDefId,
      status: 'running', started_at: now(),
    })

    const agentDef = db.agent.get(agentDefId)!
    const { runAgentSession } = await import('./agents.js')
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
      throw notFound('project not found or has no commits')
    }
  },

  read: (repoBase: string) => async (slug: string, path: string): Promise<string> => {
    try {
      return await gitExec(['show', `HEAD:${path}`], bareDir(repoBase, slug))
    } catch {
      throw notFound('file not found')
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

// ── Sandbox ──

const activeRuns = new Map<string, RunHandle>()

export const sandbox = {
  list: (db: Database) => (): SandboxRun[] =>
    db.run.all().reverse().slice(0, 200),

  get: (db: Database) => (id: string): SandboxRun =>
    require(db.run.get(id)),

  create: (db: Database, config: Config) =>
    (input: { command: string; workspace: string; session_id?: string | undefined; env?: Record<string, string> | undefined; network?: boolean | undefined }) => {
      const { command, workspace, session_id, env = {}, network = false } = input
      const row = db.run.insert({
        session_id: session_id ?? null, image: config.sandboxImage,
        command, status: 'running', started_at: now(),
      })
      const handle = spawnRun({
        command, workspace, image: config.sandboxImage,
        env, network, timeoutMs: config.sandboxTimeout,
      })
      activeRuns.set(row.id, handle)
      handle.emitter.on('exit', (code: number) => {
        db.run.update(row.id, { status: code === 0 ? 'done' : 'failed', exit_code: code, ended_at: now() })
        activeRuns.delete(row.id)
      })
      return { id: row.id, emitter: handle.emitter }
    },

  kill: (db: Database) => (id: string): { ok: true } => {
    assertStatus(require(db.run.get(id)), 'running', 'run is not active')
    const handle = activeRuns.get(id)
    if (handle) { handle.kill(); activeRuns.delete(id) }
    db.run.update(id, { status: 'failed', exit_code: -1, ended_at: now() })
    return { ok: true }
  },

  stream: (db: Database) => (id: string, res: Response): void => {
    const row = require(db.run.get(id))
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
  dispatch: (db: Database) => async (projectId: string): Promise<void> => {
    const proj = db.project.get(projectId)
    if (!proj || proj.status !== 'active') return

    const open    = ticket.list(db)({ projectId, status: 'open' })
    const claimed = ticket.list(db)({ projectId, status: 'claimed' })
    const agents  = agent.list(db)({ projectId })

    if (claimed.length >= proj.concurrency_limit) return

    for (const t of open.slice(0, proj.concurrency_limit - claimed.length)) {
      const def = agents.find(a => a.name === t.agent)
      if (!def) continue
      try { ticket.claim(db)(t.id) } catch { continue }

      const row = db.session.insert({
        ticket_id: t.id, agent_def_id: def.id,
        status: 'running', started_at: now(),
      })

      const { runAgentSession } = await import('./agents.js')
      const { config } = await import('./config.js')
      runAgentSession(db, config)(row.id, def, t).catch((err: unknown) =>
        console.error('dispatch session error:', err))
    }
  },

  recover: (db: Database) => async (): Promise<void> => {
    for (const proj of db.project.all()) {
      const cutoff = new Date(Date.now() - proj.schedule_interval * 3 * 1000).toISOString()
      for (const t of ticket.list(db)({ projectId: proj.id, status: 'claimed' })) {
        if (t.claimed_at && t.claimed_at < cutoff) {
          try { ticket.reopen(db)(t.id) } catch { /* skip */ }
        }
      }
    }
  },

  start: (db: Database) => (projectId: string, intervalSeconds: number): void => {
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

  startAll: (db: Database) => (): void => {
    for (const proj of db.project.all([db.eq(db.col.project.status, 'active')])) {
      scheduler.start(db)(proj.id, proj.schedule_interval)
    }
  },

  stopAll: (): void => {
    for (const [, timer] of intervals) clearInterval(timer)
    intervals.clear()
  },
}
