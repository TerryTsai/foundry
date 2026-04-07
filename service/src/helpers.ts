import { eq, and, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm, writeFile as fsWrite, mkdir } from 'fs/promises'
import type { EventEmitter } from 'events'
import type { Response } from 'express'
import type { Db } from './db.js'
import type { Config } from './config.js'
import type { Ticket, Project, AgentDefinition, AgentSession, AgentMessage, SandboxRun } from './schema.js'
import {
  tickets, projects, agentDefinitions, agentSessions, agentMessages, sandboxRuns,
} from './schema.js'
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

// ── Utility ──

export const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const now = () => new Date().toISOString()

// ── Tickets ──

export const listTickets = (db: Db) => (filters: z.infer<typeof listTicketsQuery>): Ticket[] => {
  const conditions = []
  if (filters.projectId) conditions.push(eq(tickets.project_id, filters.projectId))
  if (filters.agent)     conditions.push(eq(tickets.agent, filters.agent))
  if (filters.status)    conditions.push(eq(tickets.status, filters.status))
  if (filters.parentId === 'null') {
    conditions.push(isNull(tickets.parent_id))
  } else if (filters.parentId) {
    conditions.push(eq(tickets.parent_id, filters.parentId))
  }

  return conditions.length
    ? db.select().from(tickets).where(and(...conditions)).all()
    : db.select().from(tickets).all()
}

export const getTicket = (db: Db) => (id: string): Ticket => {
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) throw notFound()
  return ticket
}

export const createTicket = (db: Db) => (input: z.infer<typeof createTicketBody>): Ticket => {
  const { project_id, title, body, agent, parent_id, created_by, block } = input

  if (parent_id) {
    const parent = db.select().from(tickets).where(eq(tickets.id, parent_id)).get()
    if (!parent) throw badRequest('parent_id not found')
  }

  const id = nanoid()
  const ts = now()

  db.transaction(tx => {
    tx.insert(tickets).values({
      id, project_id, title, body, agent,
      status: 'open',
      parent_id: parent_id ?? null,
      created_by, created_at: ts,
    }).run()

    if (block && parent_id) {
      const parent = tx.select().from(tickets).where(eq(tickets.id, parent_id)).get()
      if (parent && parent.status === 'claimed') {
        tx.update(tickets).set({ status: 'blocked' }).where(eq(tickets.id, parent_id)).run()
      }
    }
  })

  return db.select().from(tickets).where(eq(tickets.id, id)).get()!
}

export const updateTicket = (db: Db) => (id: string, input: z.infer<typeof updateTicketBody>): Ticket => {
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) throw notFound()

  const updates: Record<string, unknown> = {}
  if (input.body !== undefined)  updates.body = input.body
  if (input.notes !== undefined) updates.notes = input.notes

  if (Object.keys(updates).length > 0) {
    db.update(tickets).set(updates).where(eq(tickets.id, id)).run()
  }

  return db.select().from(tickets).where(eq(tickets.id, id)).get()!
}

export const claimTicket = (db: Db) => (id: string): Ticket =>
  db.transaction(tx => {
    const ticket = tx.select().from(tickets).where(eq(tickets.id, id)).get()
    if (!ticket) throw notFound()
    if (ticket.status !== 'open') throw conflict(`cannot claim ticket with status '${ticket.status}'`)

    tx.update(tickets).set({ status: 'claimed', claimed_at: now() }).where(eq(tickets.id, id)).run()
    return tx.select().from(tickets).where(eq(tickets.id, id)).get()!
  }) as Ticket

export const completeTicket = (db: Db) => (id: string, notes?: string): Ticket =>
  db.transaction(tx => {
    const ticket = tx.select().from(tickets).where(eq(tickets.id, id)).get()
    if (!ticket) throw notFound()
    if (ticket.status !== 'claimed') throw conflict(`cannot mark done from status '${ticket.status}'`)

    tx.update(tickets)
      .set({ status: 'done', ...(notes !== undefined ? { notes } : {}) })
      .where(eq(tickets.id, id)).run()

    if (ticket.parent_id) {
      const parent = tx.select().from(tickets).where(eq(tickets.id, ticket.parent_id)).get()
      if (parent && parent.status === 'blocked') {
        tx.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticket.parent_id)).run()
      }
    }

    return tx.select().from(tickets).where(eq(tickets.id, id)).get()!
  }) as Ticket

export const failTicket = (db: Db) => (id: string, notes?: string): Ticket => {
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) throw notFound()
  if (ticket.status !== 'claimed') throw conflict(`cannot fail ticket with status '${ticket.status}'`)

  db.update(tickets)
    .set({ status: 'failed', ...(notes !== undefined ? { notes } : {}) })
    .where(eq(tickets.id, id)).run()

  return db.select().from(tickets).where(eq(tickets.id, id)).get()!
}

export const reopenTicket = (db: Db) => (id: string): Ticket => {
  const ticket = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!ticket) throw notFound()
  if (ticket.status !== 'failed') throw conflict(`cannot reopen ticket with status '${ticket.status}'`)

  db.update(tickets).set({ status: 'open', claimed_at: null }).where(eq(tickets.id, id)).run()
  return db.select().from(tickets).where(eq(tickets.id, id)).get()!
}

export interface TicketChainEntry {
  id: string; title: string; body: string
  notes: string | null; agent: string; status: string
}

export const getTicketChain = (db: Db) => (id: string): TicketChainEntry[] => {
  const chain: Ticket[] = []
  let current = db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!current) throw notFound()

  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.parent_id) break
    current = db.select().from(tickets).where(eq(tickets.id, current.parent_id)).get()
  }

  return chain.map(t => ({
    id: t.id, title: t.title, body: t.body,
    notes: t.notes, agent: t.agent, status: t.status,
  }))
}

// ── Projects ──

export const listProjects = (db: Db) => (filters: z.infer<typeof listProjectsQuery>): Project[] =>
  filters.status
    ? db.select().from(projects).where(eq(projects.status, filters.status)).all()
    : db.select().from(projects).all()

export const getProject = (db: Db) => (id: string): Project => {
  const project = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw notFound()
  return project
}

export const createProject = (db: Db) => (input: z.infer<typeof createProjectBody>): Project => {
  const { name, workspace, schedule_interval = 600, concurrency_limit = 3 } = input
  const slug = slugify(name)

  const existing = db.select().from(projects).where(eq(projects.slug, slug)).get()
  if (existing) throw conflict(`slug '${slug}' already exists`)

  const id = nanoid()
  db.insert(projects).values({
    id, name, slug, status: 'active', workspace,
    schedule_interval, concurrency_limit, created_at: now(),
  }).run()

  const project = db.select().from(projects).where(eq(projects.id, id)).get()!
  scheduleProject(db)(project.id, project.schedule_interval)
  return project
}

export const updateProject = (db: Db) => (id: string, input: z.infer<typeof updateProjectBody>): Project => {
  const project = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw notFound()

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) {
    updates.name = input.name
    updates.slug = slugify(input.name)
  }
  if (input.workspace !== undefined)         updates.workspace = input.workspace
  if (input.status !== undefined)            updates.status = input.status
  if (input.schedule_interval !== undefined) updates.schedule_interval = input.schedule_interval
  if (input.concurrency_limit !== undefined) updates.concurrency_limit = input.concurrency_limit

  if (Object.keys(updates).length === 0) return project

  db.update(projects).set(updates).where(eq(projects.id, id)).run()
  const updated = db.select().from(projects).where(eq(projects.id, id)).get()!

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
  const project = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!project) throw notFound()
  if (project.status !== 'active') throw conflict('project is paused')

  dispatch(db)(project.id).catch((err: unknown) =>
    console.error(`dispatch error for project ${project.id}:`, err))

  return { ok: true }
}

// ── Agent Definitions ──

export const listAgentDefs = (db: Db) => (filters: z.infer<typeof listAgentDefsQuery>): AgentDefinition[] =>
  filters.projectId
    ? db.select().from(agentDefinitions).where(eq(agentDefinitions.project_id, filters.projectId)).all()
    : db.select().from(agentDefinitions).all()

export const getAgentDef = (db: Db) => (id: string): AgentDefinition => {
  const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()
  if (!def) throw notFound()
  return def
}

export const createAgentDef = (db: Db) => (input: z.infer<typeof createAgentDefBody>): AgentDefinition => {
  const { project_id, name, prompt } = input

  const existing = db.select().from(agentDefinitions)
    .where(and(eq(agentDefinitions.project_id, project_id), eq(agentDefinitions.name, name)))
    .get()
  if (existing) throw conflict(`agent '${name}' already exists in project '${project_id}'`)

  const id = nanoid()
  db.insert(agentDefinitions).values({
    id, project_id, name, prompt,
    image: 'node:20-alpine', env: '[]', created_at: now(),
  }).run()

  return db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()!
}

export const updateAgentDef = (db: Db) => (id: string, input: z.infer<typeof updateAgentDefBody>): AgentDefinition => {
  const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()
  if (!def) throw notFound()

  const updates: Record<string, unknown> = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt

  if (Object.keys(updates).length > 0) {
    db.update(agentDefinitions).set(updates).where(eq(agentDefinitions.id, id)).run()
  }

  return db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()!
}

export const deleteAgentDef = (db: Db) => (id: string): { ok: true } => {
  const def = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).get()
  if (!def) throw notFound()
  db.delete(agentDefinitions).where(eq(agentDefinitions.id, id)).run()
  return { ok: true }
}

// ── Sessions ──

export const getSession = (db: Db) => (id: string): AgentSession => {
  const session = db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()
  if (!session) throw notFound()
  return session
}

export const getSessionStatus = (db: Db) => (id: string): { status: string } => {
  const session = db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()
  if (!session) throw notFound()
  return { status: session.status }
}

export const killSession = (db: Db) => (id: string): { ok: true } => {
  const session = db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()
  if (!session) throw notFound()
  if (session.status !== 'running') throw conflict(`session is not running (status: ${session.status})`)

  db.update(agentSessions)
    .set({ status: 'failed', ended_at: now() })
    .where(eq(agentSessions.id, id)).run()

  return { ok: true }
}

export const insertMessage = (db: Db) => (sessionId: string, role: string, content: string): AgentMessage => {
  const session = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
  if (!session) throw notFound()

  const id = nanoid()
  db.insert(agentMessages).values({
    id, session_id: sessionId, role, content, created_at: now(),
  }).run()

  return db.select().from(agentMessages).where(eq(agentMessages.id, id)).get()!
}

export const getMessages = (db: Db) => (sessionId: string): AgentMessage[] => {
  const session = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
  if (!session) throw notFound()
  return db.select().from(agentMessages).where(eq(agentMessages.session_id, sessionId)).all()
}

interface SessionRow {
  id: string; ticket_id: string; agent_def_id: string
  agent_name: string | null; status: string
  started_at: string; ended_at: string | null
}

export const listAllSessions = (db: Db) => (): SessionRow[] =>
  db.select({
    id:           agentSessions.id,
    ticket_id:    agentSessions.ticket_id,
    agent_def_id: agentSessions.agent_def_id,
    agent_name:   agentDefinitions.name,
    status:       agentSessions.status,
    started_at:   agentSessions.started_at,
    ended_at:     agentSessions.ended_at,
  })
  .from(agentSessions)
  .leftJoin(agentDefinitions, eq(agentSessions.agent_def_id, agentDefinitions.id))
  .orderBy(agentSessions.started_at)
  .all()
  .reverse()
  .slice(0, 200)

export const startAgentSession = (db: Db, config: Config) =>
  async (agentDefId: string, ticketId: string): Promise<AgentSession> => {
    const agentDef = db.select().from(agentDefinitions).where(eq(agentDefinitions.id, agentDefId)).get()
    if (!agentDef) throw notFound('agent definition not found')

    claimTicket(db)(ticketId)
    const ticket = getTicket(db)(ticketId)

    const sessionId = nanoid()
    db.insert(agentSessions).values({
      id: sessionId, ticket_id: ticketId,
      agent_def_id: agentDef.id, status: 'running', started_at: now(),
    }).run()

    const { runAgentSession } = await import('./agents.js')
    runAgentSession(db, config)(sessionId, agentDef, ticket).catch((err: unknown) => {
      console.error(`session ${sessionId} crashed:`, err)
    })

    return db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()!
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
  db.select().from(sandboxRuns)
    .orderBy(sandboxRuns.started_at)
    .all()
    .reverse()
    .slice(0, 200)

export const getSandboxRun = (db: Db) => (id: string): SandboxRun => {
  const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, id)).get()
  if (!run) throw notFound()
  return run
}

export const createSandboxRun = (db: Db, config: Config) =>
  (input: { command: string; workspace: string; session_id?: string | undefined; env?: Record<string, string> | undefined; network?: boolean | undefined }):
  { id: string; emitter: EventEmitter } => {
    const { command, workspace, session_id, env = {}, network = false } = input
    const id = nanoid()

    db.insert(sandboxRuns).values({
      id, session_id: session_id ?? null,
      image: config.sandboxImage, command,
      status: 'running', started_at: now(),
    }).run()

    const handle = spawnRun({
      command, workspace, image: config.sandboxImage,
      env, network, timeoutMs: config.sandboxTimeout,
    })
    activeRuns.set(id, handle)

    handle.emitter.on('exit', (code: number) => {
      db.update(sandboxRuns)
        .set({ status: code === 0 ? 'done' : 'failed', exit_code: code, ended_at: now() })
        .where(eq(sandboxRuns.id, id)).run()
      activeRuns.delete(id)
    })

    return { id, emitter: handle.emitter }
  }

export const killSandboxRun = (db: Db) => (id: string): { ok: true } => {
  const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, id)).get()
  if (!run) throw notFound()
  if (run.status !== 'running') throw conflict(`run is not active (status: ${run.status})`)

  const handle = activeRuns.get(id)
  if (handle) {
    handle.kill()
    activeRuns.delete(id)
  }

  db.update(sandboxRuns)
    .set({ status: 'failed', exit_code: -1, ended_at: now() })
    .where(eq(sandboxRuns.id, id)).run()

  return { ok: true }
}

export const streamSandboxOutput = (db: Db) => (id: string, res: Response): void => {
  const run = db.select().from(sandboxRuns).where(eq(sandboxRuns.id, id)).get()
  if (!run) throw notFound()

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sse = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  if (run.status !== 'running') {
    sse('exit', { code: run.exit_code ?? -1 })
    res.end()
    return
  }

  const handle = activeRuns.get(id)
  if (!handle) {
    sse('exit', { code: -1 })
    res.end()
    return
  }

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
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get()
  if (!project || project.status !== 'active') return

  const open    = listTickets(db)({ projectId, status: 'open' })
  const claimed = listTickets(db)({ projectId, status: 'claimed' })
  const agents  = listAgentDefs(db)({ projectId })

  if (claimed.length >= project.concurrency_limit) return

  const slots = project.concurrency_limit - claimed.length
  const toDispatch = open.slice(0, slots)

  for (const ticket of toDispatch) {
    const agentDef = agents.find(a => a.name === ticket.agent)
    if (!agentDef) continue

    const { runAgentSession } = await import('./agents.js')
    const sessionId = nanoid()

    db.insert(agentSessions).values({
      id: sessionId, ticket_id: ticket.id,
      agent_def_id: agentDef.id, status: 'running', started_at: now(),
    }).run()

    try {
      claimTicket(db)(ticket.id)
    } catch { continue }

    const { config } = await import('./config.js')
    runAgentSession(db, config)(sessionId, agentDef, ticket).catch((err: unknown) =>
      console.error('dispatch session error:', err))
  }
}

export const recoverStalledTickets = (db: Db) => async (): Promise<void> => {
  const allProjects = db.select().from(projects).all()
  for (const project of allProjects) {
    const threshold = project.schedule_interval * 3 * 1000
    const cutoff = new Date(Date.now() - threshold).toISOString()

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
  const timer = setInterval(
    () => dispatch(db)(projectId).catch((err: unknown) =>
      console.error(`dispatch error for project ${projectId}:`, err)),
    intervalSeconds * 1000,
  )
  intervals.set(projectId, timer)
}

export const clearProjectSchedule = (projectId: string): void => {
  const existing = intervals.get(projectId)
  if (existing) {
    clearInterval(existing)
    intervals.delete(projectId)
  }
}

export const startAllSchedulers = (db: Db) => (): void => {
  const active = db.select().from(projects).where(eq(projects.status, 'active')).all()
  for (const project of active) {
    scheduleProject(db)(project.id, project.schedule_interval)
  }
}

export const stopAllSchedulers = (): void => {
  for (const [, timer] of intervals) {
    clearInterval(timer)
  }
  intervals.clear()
}
