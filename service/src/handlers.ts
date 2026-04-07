import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, writeFile as fsWrite, mkdir } from 'fs/promises'
import type { Response } from 'express'
import type { Db } from './db.js'
import type { Config } from './config.js'
import type { Ticket, Project, AgentDefinition, AgentSession, AgentMessage, SandboxRun } from './schema.js'
import { notFound, conflict, badRequest, AppError } from './errors.js'
import { spawnRun, type RunHandle } from './runner.js'
import type { z } from 'zod'
import type * as v from './validate.js'

const execFileAsync = promisify(execFile)

// ── Utilities ──

const require = <T>(row: T | undefined, msg?: string): T => {
  if (!row) throw notFound(msg)
  return row
}

const assertStatus = <T extends { status: string }>(row: T, expected: string, msg?: string): T => {
  if (row.status !== expected) throw conflict(msg ?? `cannot transition from '${row.status}'`)
  return row
}

const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const now = () => new Date().toISOString()

const pick = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

// ── Tickets ──

export interface TicketChainEntry {
  id: string; title: string; body: string
  notes: string | null; agent: string; status: string
}

export const ticket = {
  list: (db: Db) => (filters: z.infer<typeof v.ticket.list>): Ticket[] => {
    const { eq, isNull, col } = db
    const conditions = [
      filters.projectId ? eq(col.ticket.project_id, filters.projectId) : null,
      filters.agent     ? eq(col.ticket.agent, filters.agent)           : null,
      filters.status    ? eq(col.ticket.status, filters.status)         : null,
      filters.parentId === 'null' ? isNull(col.ticket.parent_id)
        : filters.parentId        ? eq(col.ticket.parent_id, filters.parentId) : null,
    ].filter(Boolean) as any[]
    return db.tickets.all(conditions)
  },

  get: (db: Db) => (id: string): Ticket =>
    require(db.tickets.get(id)),

  create: (db: Db) => (input: z.infer<typeof v.ticket.create>): Ticket => {
    const { project_id, title, body, agent, parent_id, created_by, block } = input
    if (parent_id) require(db.tickets.get(parent_id), 'parent_id not found')

    return db.tx(tx => {
      const row = tx.tickets.insert({
        project_id, title, body, agent, status: 'open',
        parent_id: parent_id ?? null, created_by, created_at: now(),
      })
      if (block && parent_id && tx.tickets.get(parent_id)?.status === 'claimed') {
        tx.tickets.update(parent_id, { status: 'blocked' })
      }
      return row
    })
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.ticket.update>): Ticket => {
    require(db.tickets.get(id))
    return db.tickets.update(id, pick(input, 'body', 'notes'))
  },

  claim: (db: Db) => (id: string): Ticket =>
    db.tx(tx => {
      assertStatus(require(tx.tickets.get(id)), 'open')
      return tx.tickets.update(id, { status: 'claimed', claimed_at: now() })
    }),

  complete: (db: Db) => (id: string, notes?: string): Ticket =>
    db.tx(tx => {
      const row = assertStatus(require(tx.tickets.get(id)), 'claimed')
      tx.tickets.update(id, { status: 'done', ...(notes !== undefined ? { notes } : {}) })
      if (row.parent_id && tx.tickets.get(row.parent_id)?.status === 'blocked') {
        tx.tickets.update(row.parent_id, { status: 'open' })
      }
      return require(tx.tickets.get(id))
    }),

  fail: (db: Db) => (id: string, notes?: string): Ticket => {
    assertStatus(require(db.tickets.get(id)), 'claimed')
    return db.tickets.update(id, { status: 'failed', ...(notes !== undefined ? { notes } : {}) })
  },

  reopen: (db: Db) => (id: string): Ticket => {
    assertStatus(require(db.tickets.get(id)), 'failed')
    return db.tickets.update(id, { status: 'open', claimed_at: null })
  },

  chain: (db: Db) => (id: string): TicketChainEntry[] => {
    const chain: Ticket[] = []
    let current: Ticket | undefined = require(db.tickets.get(id))
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      chain.unshift(current)
      if (!current.parent_id) break
      current = db.tickets.get(current.parent_id)
    }
    return chain.map(t => ({
      id: t.id, title: t.title, body: t.body,
      notes: t.notes, agent: t.agent, status: t.status,
    }))
  },
}

// ── Projects ──

export const project = {
  list: (db: Db) => (filters: z.infer<typeof v.project.list>): Project[] => {
    const conditions = filters.status ? [db.eq(db.col.project.status, filters.status)] : []
    return db.projects.all(conditions)
  },

  get: (db: Db) => (id: string): Project =>
    require(db.projects.get(id)),

  create: (db: Db) => (input: z.infer<typeof v.project.create>): Project => {
    const { name, workspace, schedule_interval = 600, concurrency_limit = 3 } = input
    const slug = slugify(name)
    if (db.projects.all([db.eq(db.col.project.slug, slug)]).length > 0) {
      throw conflict(`slug '${slug}' already exists`)
    }
    const row = db.projects.insert({
      name, slug, status: 'active', workspace,
      schedule_interval, concurrency_limit, created_at: now(),
    })
    scheduler.start(db)(row.id, row.schedule_interval)
    return row
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.project.update>): Project => {
    const prev = require(db.projects.get(id))
    const updates: Record<string, unknown> = {
      ...pick(input, 'workspace', 'status', 'schedule_interval', 'concurrency_limit'),
    }
    if (input.name !== undefined) { updates.name = input.name; updates.slug = slugify(input.name) }
    if (Object.keys(updates).length === 0) return prev

    const row = db.projects.update(id, updates)
    if (input.status === 'paused') scheduler.stop(id)
    if (input.status === 'active' && prev.status === 'paused') scheduler.start(db)(id, row.schedule_interval)
    if (input.schedule_interval !== undefined && row.status === 'active') scheduler.start(db)(id, row.schedule_interval)
    return row
  },

  run: (db: Db) => (id: string): { ok: true } => {
    const row = assertStatus(require(db.projects.get(id)), 'active', 'project is paused')
    scheduler.dispatch(db)(row.id).catch((err: unknown) =>
      console.error(`dispatch error for project ${row.id}:`, err))
    return { ok: true }
  },
}

// ── Agent Definitions ──

export const agent = {
  list: (db: Db) => (filters: z.infer<typeof v.agent.list>): AgentDefinition[] => {
    const conditions = filters.projectId ? [db.eq(db.col.agent.project_id, filters.projectId)] : []
    return db.agents.all(conditions)
  },

  get: (db: Db) => (id: string): AgentDefinition =>
    require(db.agents.get(id)),

  create: (db: Db) => (input: z.infer<typeof v.agent.create>): AgentDefinition => {
    const { project_id, name, prompt } = input
    if (db.agents.all([db.eq(db.col.agent.project_id, project_id), db.eq(db.col.agent.name, name)]).length > 0) {
      throw conflict(`agent '${name}' already exists in project '${project_id}'`)
    }
    return db.agents.insert({
      project_id, name, prompt,
      image: 'node:20-alpine', env: '[]', created_at: now(),
    })
  },

  update: (db: Db) => (id: string, input: z.infer<typeof v.agent.update>): AgentDefinition => {
    require(db.agents.get(id))
    return db.agents.update(id, pick(input, 'prompt'))
  },

  remove: (db: Db) => (id: string): { ok: true } => {
    require(db.agents.get(id))
    db.agents.remove(id)
    return { ok: true }
  },
}

// ── Sessions ──

export const session = {
  get: (db: Db) => (id: string): AgentSession =>
    require(db.sessions.get(id)),

  status: (db: Db) => (id: string): { status: string } =>
    ({ status: require(db.sessions.get(id)).status }),

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(db.sessions.get(id)), 'running', 'session is not running')
    db.sessions.update(id, { status: 'failed', ended_at: now() })
    return { ok: true }
  },

  message: (db: Db) => (sessionId: string, role: string, content: string): AgentMessage => {
    require(db.sessions.get(sessionId))
    return db.messages.insert({ session_id: sessionId, role, content, created_at: now() })
  },

  messages: (db: Db) => (sessionId: string): AgentMessage[] => {
    require(db.sessions.get(sessionId))
    return db.messages.bySession(sessionId)
  },

  listAll: (db: Db) => () =>
    db.sessions.listWithAgent(),

  start: (db: Db, config: Config) => async (agentDefId: string, ticketId: string): Promise<AgentSession> => {
    require(db.agents.get(agentDefId), 'agent definition not found')
    ticket.claim(db)(ticketId)
    const t = ticket.get(db)(ticketId)

    const row = db.sessions.insert({
      ticket_id: ticketId, agent_def_id: agentDefId,
      status: 'running', started_at: now(),
    })

    const agentDef = db.agents.get(agentDefId)!
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
  list: (db: Db) => (): SandboxRun[] =>
    db.runs.all().reverse().slice(0, 200),

  get: (db: Db) => (id: string): SandboxRun =>
    require(db.runs.get(id)),

  create: (db: Db, config: Config) =>
    (input: { command: string; workspace: string; session_id?: string | undefined; env?: Record<string, string> | undefined; network?: boolean | undefined }) => {
      const { command, workspace, session_id, env = {}, network = false } = input
      const run = db.runs.insert({
        session_id: session_id ?? null, image: config.sandboxImage,
        command, status: 'running', started_at: now(),
      })
      const handle = spawnRun({
        command, workspace, image: config.sandboxImage,
        env, network, timeoutMs: config.sandboxTimeout,
      })
      activeRuns.set(run.id, handle)
      handle.emitter.on('exit', (code: number) => {
        db.runs.update(run.id, { status: code === 0 ? 'done' : 'failed', exit_code: code, ended_at: now() })
        activeRuns.delete(run.id)
      })
      return { id: run.id, emitter: handle.emitter }
    },

  kill: (db: Db) => (id: string): { ok: true } => {
    assertStatus(require(db.runs.get(id)), 'running', 'run is not active')
    const handle = activeRuns.get(id)
    if (handle) { handle.kill(); activeRuns.delete(id) }
    db.runs.update(id, { status: 'failed', exit_code: -1, ended_at: now() })
    return { ok: true }
  },

  stream: (db: Db) => (id: string, res: Response): void => {
    const run = require(db.runs.get(id))
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sse = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    if (run.status !== 'running') { sse('exit', { code: run.exit_code ?? -1 }); res.end(); return }

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
    const proj = db.projects.get(projectId)
    if (!proj || proj.status !== 'active') return

    const open    = ticket.list(db)({ projectId, status: 'open' })
    const claimed = ticket.list(db)({ projectId, status: 'claimed' })
    const agents  = agent.list(db)({ projectId })

    if (claimed.length >= proj.concurrency_limit) return

    for (const t of open.slice(0, proj.concurrency_limit - claimed.length)) {
      const def = agents.find(a => a.name === t.agent)
      if (!def) continue
      try { ticket.claim(db)(t.id) } catch { continue }

      const row = db.sessions.insert({
        ticket_id: t.id, agent_def_id: def.id,
        status: 'running', started_at: now(),
      })

      const { runAgentSession } = await import('./agents.js')
      const { config } = await import('./config.js')
      runAgentSession(db, config)(row.id, def, t).catch((err: unknown) =>
        console.error('dispatch session error:', err))
    }
  },

  recover: (db: Db) => async (): Promise<void> => {
    for (const proj of db.projects.all()) {
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
    for (const proj of db.projects.all([db.eq(db.col.project.status, 'active')])) {
      scheduler.start(db)(proj.id, proj.schedule_interval)
    }
  },

  stopAll: (): void => {
    for (const [, timer] of intervals) clearInterval(timer)
    intervals.clear()
  },
}
