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
import type {
  createTicketBody, updateTicketBody, listTicketsQuery,
  createProjectBody, updateProjectBody, listProjectsQuery,
  createAgentDefBody, updateAgentDefBody, listAgentDefsQuery,
  createSandboxBody,
} from './validation.js'

const execFileAsync = promisify(execFile)

// ── Functional Utilities ──

const require = <T>(row: T | undefined, msg?: string): T => {
  if (!row) throw notFound(msg)
  return row
}

const assertStatus = <T extends { status: string }>(row: T, expected: string, msg?: string): T => {
  if (row.status !== expected) throw conflict(msg ?? `cannot transition from '${row.status}'`)
  return row
}

export const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const now = () => new Date().toISOString()

const pick = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

// ── Tickets ──

export const listTickets = (db: Db) => (filters: z.infer<typeof listTicketsQuery>): Ticket[] => {
  const { eq, isNull, col } = db
  const conditions = [
    filters.projectId ? eq(col.ticket.project_id, filters.projectId) : null,
    filters.agent     ? eq(col.ticket.agent, filters.agent)           : null,
    filters.status    ? eq(col.ticket.status, filters.status)         : null,
    filters.parentId === 'null' ? isNull(col.ticket.parent_id)
      : filters.parentId        ? eq(col.ticket.parent_id, filters.parentId) : null,
  ].filter(Boolean) as any[]

  return db.tickets.all(conditions)
}

export const getTicket = (db: Db) => (id: string): Ticket =>
  require(db.tickets.get(id))

export const createTicket = (db: Db) => (input: z.infer<typeof createTicketBody>): Ticket => {
  const { project_id, title, body, agent, parent_id, created_by, block } = input

  if (parent_id) require(db.tickets.get(parent_id), 'parent_id not found')

  return db.tx(tx => {
    const ticket = tx.tickets.insert({
      project_id, title, body, agent,
      status: 'open', parent_id: parent_id ?? null,
      created_by, created_at: now(),
    })

    if (block && parent_id) {
      const parent = tx.tickets.get(parent_id)
      if (parent?.status === 'claimed') {
        tx.tickets.update(parent_id, { status: 'blocked' })
      }
    }

    return ticket
  })
}

export const updateTicket = (db: Db) => (id: string, input: z.infer<typeof updateTicketBody>): Ticket => {
  require(db.tickets.get(id))
  return db.tickets.update(id, pick(input, 'body', 'notes'))
}

export const claimTicket = (db: Db) => (id: string): Ticket =>
  db.tx(tx => {
    assertStatus(require(tx.tickets.get(id)), 'open')
    return tx.tickets.update(id, { status: 'claimed', claimed_at: now() })
  })

export const completeTicket = (db: Db) => (id: string, notes?: string): Ticket =>
  db.tx(tx => {
    const ticket = assertStatus(require(tx.tickets.get(id)), 'claimed')

    tx.tickets.update(id, { status: 'done', ...(notes !== undefined ? { notes } : {}) })

    if (ticket.parent_id) {
      const parent = tx.tickets.get(ticket.parent_id)
      if (parent?.status === 'blocked') {
        tx.tickets.update(ticket.parent_id, { status: 'open' })
      }
    }

    return require(tx.tickets.get(id))
  })

export const failTicket = (db: Db) => (id: string, notes?: string): Ticket => {
  assertStatus(require(db.tickets.get(id)), 'claimed')
  return db.tickets.update(id, { status: 'failed', ...(notes !== undefined ? { notes } : {}) })
}

export const reopenTicket = (db: Db) => (id: string): Ticket => {
  assertStatus(require(db.tickets.get(id)), 'failed')
  return db.tickets.update(id, { status: 'open', claimed_at: null })
}

export interface TicketChainEntry {
  id: string; title: string; body: string
  notes: string | null; agent: string; status: string
}

export const getTicketChain = (db: Db) => (id: string): TicketChainEntry[] => {
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
}

// ── Projects ──

export const listProjects = (db: Db) => (filters: z.infer<typeof listProjectsQuery>): Project[] => {
  const conditions = filters.status ? [db.eq(db.col.project.status, filters.status)] : []
  return db.projects.all(conditions)
}

export const getProject = (db: Db) => (id: string): Project =>
  require(db.projects.get(id))

export const createProject = (db: Db) => (input: z.infer<typeof createProjectBody>): Project => {
  const { name, workspace, schedule_interval = 600, concurrency_limit = 3 } = input
  const slug = slugify(name)

  if (db.projects.all([db.eq(db.col.project.slug, slug)]).length > 0) {
    throw conflict(`slug '${slug}' already exists`)
  }

  const project = db.projects.insert({
    name, slug, status: 'active', workspace,
    schedule_interval, concurrency_limit, created_at: now(),
  })

  scheduleProject(db)(project.id, project.schedule_interval)
  return project
}

export const updateProject = (db: Db) => (id: string, input: z.infer<typeof updateProjectBody>): Project => {
  const project = require(db.projects.get(id))

  const updates: Record<string, unknown> = {
    ...pick(input, 'workspace', 'status', 'schedule_interval', 'concurrency_limit'),
  }
  if (input.name !== undefined) {
    updates.name = input.name
    updates.slug = slugify(input.name)
  }

  if (Object.keys(updates).length === 0) return project

  const updated = db.projects.update(id, updates)

  if (input.status === 'paused') clearProjectSchedule(id)
  if (input.status === 'active' && project.status === 'paused') {
    scheduleProject(db)(id, updated.schedule_interval)
  }
  if (input.schedule_interval !== undefined && updated.status === 'active') {
    scheduleProject(db)(id, updated.schedule_interval)
  }

  return updated
}

export const runProject = (db: Db) => (id: string): { ok: true } => {
  const project = assertStatus(require(db.projects.get(id)), 'active', 'project is paused')

  dispatch(db)(project.id).catch((err: unknown) =>
    console.error(`dispatch error for project ${project.id}:`, err))

  return { ok: true }
}

// ── Agent Definitions ──

export const listAgentDefs = (db: Db) => (filters: z.infer<typeof listAgentDefsQuery>): AgentDefinition[] => {
  const conditions = filters.projectId ? [db.eq(db.col.agent.project_id, filters.projectId)] : []
  return db.agents.all(conditions)
}

export const getAgentDef = (db: Db) => (id: string): AgentDefinition =>
  require(db.agents.get(id))

export const createAgentDef = (db: Db) => (input: z.infer<typeof createAgentDefBody>): AgentDefinition => {
  const { project_id, name, prompt } = input

  const { eq, and, col } = db
  if (db.agents.all([eq(col.agent.project_id, project_id), eq(col.agent.name, name)]).length > 0) {
    throw conflict(`agent '${name}' already exists in project '${project_id}'`)
  }

  return db.agents.insert({
    project_id, name, prompt,
    image: 'node:20-alpine', env: '[]', created_at: now(),
  })
}

export const updateAgentDef = (db: Db) => (id: string, input: z.infer<typeof updateAgentDefBody>): AgentDefinition => {
  require(db.agents.get(id))
  return db.agents.update(id, pick(input, 'prompt'))
}

export const deleteAgentDef = (db: Db) => (id: string): { ok: true } => {
  require(db.agents.get(id))
  db.agents.remove(id)
  return { ok: true }
}

// ── Sessions ──

export const getSession = (db: Db) => (id: string): AgentSession =>
  require(db.sessions.get(id))

export const getSessionStatus = (db: Db) => (id: string): { status: string } =>
  ({ status: require(db.sessions.get(id)).status })

export const killSession = (db: Db) => (id: string): { ok: true } => {
  assertStatus(require(db.sessions.get(id)), 'running', 'session is not running')
  db.sessions.update(id, { status: 'failed', ended_at: now() })
  return { ok: true }
}

export const insertMessage = (db: Db) => (sessionId: string, role: string, content: string): AgentMessage => {
  require(db.sessions.get(sessionId))
  return db.messages.insert({ session_id: sessionId, role, content, created_at: now() })
}

export const getMessages = (db: Db) => (sessionId: string): AgentMessage[] => {
  require(db.sessions.get(sessionId))
  return db.messages.bySession(sessionId)
}

export const listAllSessions = (db: Db) => () =>
  db.sessions.listWithAgent()

export const startAgentSession = (db: Db, config: Config) =>
  async (agentDefId: string, ticketId: string): Promise<AgentSession> => {
    require(db.agents.get(agentDefId), 'agent definition not found')

    claimTicket(db)(ticketId)
    const ticket = getTicket(db)(ticketId)

    const session = db.sessions.insert({
      ticket_id: ticketId, agent_def_id: agentDefId,
      status: 'running', started_at: now(),
    })

    const agentDef = db.agents.get(agentDefId)!
    const { runAgentSession } = await import('./agents.js')
    runAgentSession(db, config)(session.id, agentDef, ticket).catch((err: unknown) => {
      console.error(`session ${session.id} crashed:`, err)
    })

    return session
  }

// ── Files ──

const gitExec = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

const bareDir = (repoBase: string, slug: string): string =>
  join(repoBase, `${slug}.git`)

export const gitListFiles = (repoBase: string) => async (slug: string): Promise<string[]> => {
  try {
    const out = await gitExec(['ls-tree', '-r', 'HEAD', '--name-only'], bareDir(repoBase, slug))
    return out.trim() ? out.trim().split('\n') : []
  } catch {
    throw notFound('project not found or has no commits')
  }
}

export const gitReadFile = (repoBase: string) => async (slug: string, path: string): Promise<string> => {
  try {
    return await gitExec(['show', `HEAD:${path}`], bareDir(repoBase, slug))
  } catch {
    throw notFound('file not found')
  }
}

export const gitWriteFile = (repoBase: string) => async (slug: string, path: string, content: string, message: string): Promise<{ ok: true }> => {
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
}

// ── Sandbox ──

const activeRuns = new Map<string, RunHandle>()

export const getRunHandle = (id: string): RunHandle | undefined =>
  activeRuns.get(id)

export const listSandboxRuns = (db: Db) => (): SandboxRun[] =>
  db.runs.all().reverse().slice(0, 200)

export const getSandboxRun = (db: Db) => (id: string): SandboxRun =>
  require(db.runs.get(id))

export const createSandboxRun = (db: Db, config: Config) =>
  (input: { command: string; workspace: string; session_id?: string | undefined; env?: Record<string, string> | undefined; network?: boolean | undefined }) => {
    const { command, workspace, session_id, env = {}, network = false } = input

    const run = db.runs.insert({
      session_id: session_id ?? null,
      image: config.sandboxImage, command,
      status: 'running', started_at: now(),
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
  }

export const killSandboxRun = (db: Db) => (id: string): { ok: true } => {
  assertStatus(require(db.runs.get(id)), 'running', 'run is not active')

  const handle = activeRuns.get(id)
  if (handle) { handle.kill(); activeRuns.delete(id) }

  db.runs.update(id, { status: 'failed', exit_code: -1, ended_at: now() })
  return { ok: true }
}

export const streamSandboxOutput = (db: Db) => (id: string, res: Response): void => {
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
}

// ── Scheduler ──

const intervals = new Map<string, ReturnType<typeof setInterval>>()

export const dispatch = (db: Db) => async (projectId: string): Promise<void> => {
  const project = db.projects.get(projectId)
  if (!project || project.status !== 'active') return

  const open    = listTickets(db)({ projectId, status: 'open' })
  const claimed = listTickets(db)({ projectId, status: 'claimed' })
  const agents  = listAgentDefs(db)({ projectId })

  if (claimed.length >= project.concurrency_limit) return

  const toDispatch = open.slice(0, project.concurrency_limit - claimed.length)

  for (const ticket of toDispatch) {
    const agentDef = agents.find(a => a.name === ticket.agent)
    if (!agentDef) continue

    try { claimTicket(db)(ticket.id) } catch { continue }

    const session = db.sessions.insert({
      ticket_id: ticket.id, agent_def_id: agentDef.id,
      status: 'running', started_at: now(),
    })

    const { runAgentSession } = await import('./agents.js')
    const { config } = await import('./config.js')
    runAgentSession(db, config)(session.id, agentDef, ticket).catch((err: unknown) =>
      console.error('dispatch session error:', err))
  }
}

export const recoverStalledTickets = (db: Db) => async (): Promise<void> => {
  for (const project of db.projects.all()) {
    const cutoff = new Date(Date.now() - project.schedule_interval * 3 * 1000).toISOString()
    const claimed = listTickets(db)({ projectId: project.id, status: 'claimed' })

    for (const ticket of claimed) {
      if (ticket.claimed_at && ticket.claimed_at < cutoff) {
        try { reopenTicket(db)(ticket.id) } catch { /* skip */ }
      }
    }
  }
}

export const scheduleProject = (db: Db) => (projectId: string, intervalSeconds: number): void => {
  clearProjectSchedule(projectId)
  intervals.set(projectId, setInterval(
    () => dispatch(db)(projectId).catch((err: unknown) =>
      console.error(`dispatch error for project ${projectId}:`, err)),
    intervalSeconds * 1000,
  ))
}

export const clearProjectSchedule = (projectId: string): void => {
  const existing = intervals.get(projectId)
  if (existing) { clearInterval(existing); intervals.delete(projectId) }
}

export const startAllSchedulers = (db: Db) => (): void => {
  for (const project of db.projects.all([db.eq(db.col.project.status, 'active')])) {
    scheduleProject(db)(project.id, project.schedule_interval)
  }
}

export const stopAllSchedulers = (): void => {
  for (const [, timer] of intervals) clearInterval(timer)
  intervals.clear()
}
