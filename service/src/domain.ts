import { randomBytes } from 'crypto'
import { mkdirSync } from 'fs'
import type { Response } from 'express'
import { eq, and, isNull } from 'drizzle-orm'

import { type Db } from './database.js'
import * as database from './database.js'
import * as schema from './schema.js'
import type { Account, Ticket, Comment, Connection, Agent, Session, Message, Execution } from './schema.js'
import type { Config } from './config.js'
import { require, assertStatus, pick, now, AppError, conflict, badRequest, notFound } from './functional.js'
import { supported } from './runtime/model.js'
import { spawnRun, type RunHandle } from './runtime/sandbox.js'
import type { z } from 'zod'
import * as validate from './validate.js'
import * as github from './github.js'

function ts(): { created_at: string; updated_at: string } {
  const t = now()
  return { created_at: t, updated_at: t }
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

// Ownership-aware fetch: 404 (not 403) on mismatch so other accounts can't
// probe for valid project ids.
function projectGetOwned(db: Db, id: string, accountId: string): schema.Project {
  const row = database.projectGet(db, id)
  if (!row || row.owner_id !== accountId) throw notFound()
  return row
}

export function projectList(db: Db, accountId: string, filters: z.infer<typeof validate.projectList>): schema.Project[] {
  const conditions = [eq(schema.project.owner_id, accountId)]
  if (filters.status) conditions.push(eq(schema.project.status, filters.status))
  return database.projectAll(db, conditions)
}

export function projectGet(db: Db, accountId: string, id: string): schema.Project {
  return projectGetOwned(db, id, accountId)
}

export function projectCreate(db: Db, accountId: string, input: z.infer<typeof validate.projectCreate>): schema.Project {
  const { name, repo, schedule_interval = 600, concurrency_limit = 3 } = input
  const row = database.projectInsert(db, {
    owner_id: accountId,
    repo, name, status: 'active',
    schedule_interval, concurrency_limit, ...ts(),
  })
  schedulerStart(db, row.id, row.schedule_interval)
  return row
}

export function projectUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.projectUpdate>): schema.Project {
  const prev = projectGetOwned(db, id, accountId)
  const updates: Record<string, unknown> = {
    ...pick(input, 'name', 'repo', 'status', 'schedule_interval', 'concurrency_limit'),
    updated_at: now(),
  }
  if (Object.keys(updates).length <= 1) return prev

  const row = database.projectUpdate(db, id, updates)
  if (input.status === 'archived') schedulerStop(id)
  if (input.status === 'active' && prev.status === 'archived') schedulerStart(db, id, row.schedule_interval)
  if (input.schedule_interval !== undefined && row.status === 'active') schedulerStart(db, id, row.schedule_interval)
  return row
}

export function projectRun(db: Db, accountId: string, id: string): { ok: true } {
  const row = assertStatus(projectGetOwned(db, id, accountId), 'active', 'project is not active')
  schedulerDispatch(db, row.id).catch((err: unknown) =>
    console.error(`dispatch error for project ${row.id}:`, err))
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

const STATE_TTL_SEC = 60 * 10  // 10 min for the OAuth state cookie

export function authStart(config: Config, baseUrl: string): { url: string; state: string } {
  const state = randomBytes(32).toString('hex')
  return { url: github.oauthAuthorizeUrl(config, baseUrl, state), state }
}

export async function authCallback(
  db: Db,
  config: Config,
  input: z.infer<typeof validate.authCallback>,
  stateCookie: string | undefined,
): Promise<{ sessionId: string; expiresAt: Date; account: Account }> {
  if (!stateCookie || stateCookie !== input.state) throw badRequest('invalid oauth state')
  const token = await github.oauthExchangeCode(config, input.code)
  const user  = await github.fetchUser(token)
  const account = database.accountUpsertByGithubId(db, user)

  const sessionId = randomBytes(32).toString('hex')
  const created   = new Date()
  const expires   = new Date(created.getTime() + config.sessionMaxAgeSec * 1000)
  database.authSessionInsert(db, {
    id:         sessionId,
    account_id: account.id,
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
  })

  // First-time bootstrap: if this account matches OWNER_GITHUB_LOGIN, claim
  // any unowned projects. Idempotent — safe to run on every login.
  if (config.ownerGitHubLogin && account.login === config.ownerGitHubLogin) {
    const claimed = database.claimUnownedProjects(db, account.login)
    if (claimed > 0) console.log(`claimed ${claimed} unowned project(s) for ${account.login}`)
  }

  return { sessionId, expiresAt: expires, account }
}

export function authMe(account: Account): { id: string; login: string; name: string | null; avatar_url: string | null } {
  return { id: account.id, login: account.login, name: account.name, avatar_url: account.avatar_url }
}

export function authLogout(db: Db, sessionId: string): { ok: true } {
  database.authSessionRemove(db, sessionId)
  return { ok: true }
}

export const AUTH_STATE_TTL_SEC = STATE_TTL_SEC

// ════════════════════════════════════════════════════════════════════════════
// PROVIDER
// ════════════════════════════════════════════════════════════════════════════

// Masked shape returned by the API — secrets are never serialized directly.
// A preview of api_key (when present in secrets) is shown so the UI can help
// operators confirm they're looking at the right credential.
type MaskedConnection = Omit<Connection, 'secrets'> & { api_key_preview: string | null }

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function maskConnection(c: Connection): MaskedConnection {
  const { secrets, ...rest } = c
  let preview: string | null = null
  try {
    const parsed = JSON.parse(secrets) as Record<string, unknown>
    const key = parsed.api_key
    if (typeof key === 'string' && key.length > 0) preview = maskKey(key)
  } catch { /* secrets not JSON — leave preview null */ }
  return { ...rest, api_key_preview: preview }
}

export function connectionList(db: Db): MaskedConnection[] {
  return database.connectionAll(db).map(maskConnection)
}

export function connectionGet(db: Db, id: string): MaskedConnection {
  return maskConnection(require(database.connectionGet(db, id), `connection '${id}' not found`))
}

export function connectionCreate(db: Db, input: z.infer<typeof validate.connectionCreate>): MaskedConnection {
  if (!supported.includes(input.kind)) throw badRequest(`unsupported connection kind '${input.kind}' — supported: ${supported.join(', ')}`)
  if (database.connectionGetByName(db, input.name)) throw conflict(`connection '${input.name}' already exists`)
  const row = database.connectionInsert(db, {
    project_id: input.project_id ?? null,
    kind:       input.kind,
    name:       input.name,
    config:     JSON.stringify(input.config ?? {}),
    secrets:    JSON.stringify(input.secrets ?? {}),
    ...ts(),
  })
  return maskConnection(row)
}

export function connectionUpdate(db: Db, id: string, input: z.infer<typeof validate.connectionUpdate>): MaskedConnection {
  require(database.connectionGet(db, id), `connection '${id}' not found`)
  const data: Record<string, unknown> = { updated_at: now() }
  if (input.name    !== undefined) data.name    = input.name
  if (input.config  !== undefined) data.config  = JSON.stringify(input.config)
  if (input.secrets !== undefined) data.secrets = JSON.stringify(input.secrets)
  return maskConnection(database.connectionUpdate(db, id, data))
}

export function connectionRemove(db: Db, id: string): { ok: true } {
  require(database.connectionGet(db, id), `connection '${id}' not found`)
  database.connectionRemove(db, id)
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// SCHEDULER
// ════════════════════════════════════════════════════════════════════════════

const intervals = new Map<string, ReturnType<typeof setInterval>>()

export async function schedulerDispatch(db: Db, projectId: string): Promise<void> {
  const proj = database.projectGet(db, projectId)
  if (!proj || proj.status !== 'active') return

  const open     = ticketList(db, { projectId, status: 'open' })
  const reopened = ticketList(db, { projectId, status: 'reopened' })
  const claimed  = ticketList(db, { projectId, status: 'claimed' })
  const agents   = agentList(db, { projectId })

  if (claimed.length >= proj.concurrency_limit) return

  const eligible = [...open, ...reopened].filter(t => t.agent_id && agents.find(a => a.id === t.agent_id))

  for (const t of eligible.slice(0, proj.concurrency_limit - claimed.length)) {
    const def = agents.find(a => a.id === t.agent_id)!
    try { ticketClaim(db, t.id) } catch { continue }

    const row = database.sessionInsert(db, {
      ticket_id: t.id, agent_id: def.id,
      status: 'running', model: def.model, started_at: now(),
    })

    const { runAgentSession } = await import('./runtime/runner.js')
    const { config } = await import('./config.js')
    runAgentSession(db, config, row.id, def, t).catch((err: unknown) =>
      console.error('dispatch session error:', err))
  }
}

export async function schedulerRecover(db: Db): Promise<void> {
  // Stale claimed tickets (orphaned by a server restart or crashed session)
  // get released back to 'open' so they can be picked up again. This is a
  // direct status reset, not a user-driven reopen.
  for (const proj of database.projectAll(db)) {
    const cutoff = new Date(Date.now() - proj.schedule_interval * 3 * 1000).toISOString()
    for (const t of ticketList(db, { projectId: proj.id, status: 'claimed' })) {
      if (t.claimed_at && t.claimed_at < cutoff) {
        database.ticketUpdate(db, t.id, { status: 'open', claimed_at: null, updated_at: now() })
      }
    }
  }
}

export function schedulerStart(db: Db, projectId: string, intervalSeconds: number): void {
  schedulerStop(projectId)
  intervals.set(projectId, setInterval(
    () => schedulerDispatch(db, projectId).catch((err: unknown) =>
      console.error(`dispatch error for project ${projectId}:`, err)),
    intervalSeconds * 1000,
  ))
}

export function schedulerStop(projectId: string): void {
  const existing = intervals.get(projectId)
  if (existing) { clearInterval(existing); intervals.delete(projectId) }
}

export function schedulerStartAll(db: Db): void {
  for (const proj of database.projectAll(db, [eq(schema.project.status, 'active')])) {
    schedulerStart(db, proj.id, proj.schedule_interval)
  }
}

export function schedulerStopAll(): void {
  for (const [, timer] of intervals) clearInterval(timer)
  intervals.clear()
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export function ticketList(db: Db, filters: z.infer<typeof validate.ticketList>): Ticket[] {
  const conditions = [
    filters.projectId ? eq(schema.ticket.project_id, filters.projectId) : null,
    filters.agentId   ? eq(schema.ticket.agent_id, filters.agentId)     : null,
    filters.status    ? eq(schema.ticket.status, filters.status)         : null,
    filters.parentId === 'null' ? isNull(schema.ticket.parent_id)
      : filters.parentId        ? eq(schema.ticket.parent_id, filters.parentId) : null,
  ].filter(Boolean) as any[]
  return database.ticketAll(db, conditions)
}

export function ticketGet(db: Db, id: string): Ticket {
  return require(database.ticketGet(db, id))
}

export function ticketCreate(db: Db, input: z.infer<typeof validate.ticketCreate>): Ticket {
  const { project_id, agent_id, title, body, priority, parent_id, created_by, block } = input
  if (parent_id) require(database.ticketGet(db, parent_id), 'parent_id not found')

  return db.transaction(tx => {
    const row = database.ticketInsert(tx as any, {
      project_id, agent_id: agent_id ?? null, title, body, priority,
      status: 'open', parent_id: parent_id ?? null,
      created_by, ...ts(), claimed_at: null,
    })
    if (block && parent_id && database.ticketGet(tx as any, parent_id)?.status === 'claimed') {
      database.ticketUpdate(tx as any, parent_id, { status: 'blocked', updated_at: now() })
    }
    return row
  }) as Ticket
}

export function ticketUpdate(db: Db, id: string, input: z.infer<typeof validate.ticketUpdate>): Ticket {
  assertStatus(require(database.ticketGet(db, id)), 'open', 'ticket can only be edited while open')
  return database.ticketUpdate(db, id, { ...pick(input, 'title', 'body', 'agent_id', 'priority'), updated_at: now() })
}

export function ticketClaim(db: Db, id: string): Ticket {
  return db.transaction(tx => {
    assertStatus(require(database.ticketGet(tx as any, id)), ['open', 'reopened'])
    return database.ticketUpdate(tx as any, id, { status: 'claimed', claimed_at: now(), updated_at: now() })
  }) as Ticket
}

export function ticketComplete(db: Db, id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket {
  return db.transaction(tx => {
    const d = tx as any
    const row = assertStatus(require(database.ticketGet(d, id)), 'claimed')
    database.ticketUpdate(d, id, { status: 'done', updated_at: now() })
    const author = opts?.agentName ?? 'system'
    const body = opts?.notes ? `Session completed\n${opts.notes}` : 'Session completed'
    database.commentInsert(d, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
    if (row.parent_id && database.ticketGet(d, row.parent_id)?.status === 'blocked') {
      database.ticketUpdate(d, row.parent_id, { status: 'open', updated_at: now() })
    }
    return require(database.ticketGet(d, id))
  }) as Ticket
}

export function ticketFail(db: Db, id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket {
  assertStatus(require(database.ticketGet(db, id)), 'claimed')
  const row = database.ticketUpdate(db, id, { status: 'failed', updated_at: now() })
  const author = opts?.agentName ?? 'system'
  const body = opts?.notes ? `Session failed\n${opts.notes}` : 'Session failed'
  database.commentInsert(db, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
  return row
}

export function ticketReopen(db: Db, id: string): Ticket {
  assertStatus(require(database.ticketGet(db, id)), ['done', 'failed'], 'only done or failed tickets can be reopened')
  return database.ticketUpdate(db, id, { status: 'reopened', claimed_at: null, updated_at: now() })
}

export function ticketChain(db: Db, id: string): TicketChainEntry[] {
  const chain: Ticket[] = []
  let current: Ticket | undefined = require(database.ticketGet(db, id))
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.parent_id) break
    current = database.ticketGet(db, current.parent_id)
  }
  return chain.map(t => ({
    id: t.id, title: t.title, body: t.body,
    agent_id: t.agent_id, status: t.status,
  }))
}

// ────────────────────────────────────────────────────────────────────────────
// COMMENT
// ────────────────────────────────────────────────────────────────────────────

export function commentList(db: Db, ticketId: string): Comment[] {
  require(database.ticketGet(db, ticketId))
  return database.commentByTicket(db, ticketId)
}

export function commentCreate(db: Db, ticketId: string, input: { author: string; body: string; session_id?: string }): Comment {
  require(database.ticketGet(db, ticketId))
  return database.commentInsert(db, { ticket_id: ticketId, session_id: input.session_id ?? null, author: input.author, body: input.body, created_at: now() })
}
// Returns a formatted block of everything that's been said on this ticket
// outside the current session. Includes all prior comments — both the
// agent's own previous responses (so it remembers what it produced) and
// human feedback (so it can act on revisions). Strips session-marker noise.
// The feedback section is footer-marked as authoritative, since human
// follow-ups frequently override the original ticket body.
export function ticketPriorHistory(db: Db, ticketId: string, sessionId: string, agentName: string): string {
  const NOISE = new Set(['Session started', 'Session started (SDK)', 'Session completed'])
  const comments = database.commentByTicket(db, ticketId)
    .filter(c => c.session_id !== sessionId && !NOISE.has(c.body))
  if (comments.length === 0) return ''
  const own      = comments.filter(c => c.author === agentName)
  const feedback = comments.filter(c => c.author !== agentName)
  const sections: string[] = []
  if (own.length > 0) {
    sections.push('## Your prior responses on this ticket\n\n' + own.map(c => c.body).join('\n\n---\n\n'))
  }
  if (feedback.length > 0) {
    sections.push(
      '## Feedback from the founder\n\n' +
      feedback.map(c => `[${c.author}]: ${c.body}`).join('\n\n') +
      '\n\nThe feedback above takes precedence over the original ticket body when they conflict. Address the most recent feedback in this run.',
    )
  }
  return sections.join('\n\n---\n\n')
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export function agentList(db: Db, filters: z.infer<typeof validate.agentList>): Agent[] {
  const conditions = filters.projectId ? [eq(schema.agent.project_id, filters.projectId)] : []
  return database.agentAll(db, conditions)
}

export function agentGet(db: Db, id: string): Agent {
  return require(database.agentGet(db, id))
}

export function agentCreate(db: Db, input: z.infer<typeof validate.agentCreate>): Agent {
  const { project_id, connection_id, name, model, prompt, max_tokens, max_steps, temperature, reasoning_budget, tools } = input
  require(database.connectionGet(db, connection_id), `connection '${connection_id}' not found`)
  if (database.agentAll(db, [eq(schema.agent.project_id, project_id), eq(schema.agent.name, name)]).length > 0) {
    throw conflict(`agent '${name}' already exists in project '${project_id}'`)
  }
  return database.agentInsert(db, {
    project_id, connection_id, name, model, prompt,
    max_tokens: max_tokens ?? 8192, max_steps: max_steps ?? 20,
    temperature: temperature ?? null,
    reasoning_budget: reasoning_budget ?? null,
    tools: tools ? JSON.stringify(tools) : null,
    ...ts(),
  })
}

export function agentUpdate(db: Db, id: string, input: z.infer<typeof validate.agentUpdate>): Agent {
  require(database.agentGet(db, id))
  if (input.connection_id) require(database.connectionGet(db, input.connection_id), `connection '${input.connection_id}' not found`)
  const data: Record<string, unknown> = { ...pick(input, 'connection_id', 'model', 'prompt', 'max_tokens', 'max_steps', 'temperature', 'reasoning_budget'), updated_at: now() }
  if (input.tools !== undefined) data.tools = JSON.stringify(input.tools)
  return database.agentUpdate(db, id, data)
}

export function agentRemove(db: Db, id: string): { ok: true } {
  require(database.agentGet(db, id))
  database.agentRemove(db, id)
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════
// SESSION
// ════════════════════════════════════════════════════════════════════════════

export function sessionGet(db: Db, id: string) {
  return require(database.sessionGetAggregated(db, id))
}

export function sessionStatus(db: Db, id: string): { status: string } {
  return { status: require(database.sessionGet(db, id)).status }
}

export function sessionKill(db: Db, id: string): { ok: true } {
  assertStatus(require(database.sessionGet(db, id)), 'running', 'session is not running')
  database.sessionUpdate(db, id, { status: 'failed', error: 'killed', ended_at: now() })
  return { ok: true }
}

export function sessionMessage(db: Db, sessionId: string, role: string, content: string, tokens?: number, tokensIn?: number, toolCallCount?: number): Message {
  require(database.sessionGet(db, sessionId))
  return database.messageInsert(db, {
    session_id: sessionId, role, content,
    tokens: tokens ?? null, tokens_in: tokensIn ?? null,
    tool_call_count: toolCallCount ?? null,
    created_at: now(),
  })
}

export function sessionMessages(db: Db, sessionId: string): Message[] {
  require(database.sessionGet(db, sessionId))
  return database.messageBySession(db, sessionId)
}

export function sessionByTicket(db: Db, ticketId: string) {
  require(database.ticketGet(db, ticketId))
  return database.sessionByTicket(db, ticketId)
}

export function sessionListAll(db: Db) {
  return database.sessionListWithAgent(db)
}

export async function sessionStart(db: Db, config: Config, agentDefId: string, ticketId: string): Promise<Session> {
  const agentDef = require(database.agentGet(db, agentDefId), 'agent not found')
  ticketClaim(db, ticketId)
  const t = ticketGet(db, ticketId)

  const row = database.sessionInsert(db, {
    ticket_id: ticketId, agent_id: agentDefId,
    status: 'running', model: agentDef.model, started_at: now(),
  })

  const { runAgentSession } = await import('./runtime/runner.js')
  runAgentSession(db, config, row.id, agentDef, t).catch((err: unknown) =>
    console.error(`session ${row.id} crashed:`, err))

  return row
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION
// ════════════════════════════════════════════════════════════════════════════

const activeRuns = new Map<string, RunHandle>()

export function executionList(db: Db): Execution[] {
  return database.executionAll(db).reverse().slice(0, 200)
}

export function executionGet(db: Db, id: string): Execution {
  return require(database.executionGet(db, id))
}

export function executionBySession(db: Db, sessionId: string): Execution[] {
  require(database.sessionGet(db, sessionId))
  return database.executionBySession(db, sessionId)
}

export function executionCreate(db: Db, config: Config, input: {
  command:    string
  session_id?: string
  tool_name?:  string
  tool_input?: unknown
  timeout_ms?: number
  memory_mb?:  number
  network?:    boolean
  workspace?:  string
  // env is passed directly to podman and NEVER serialized to the DB —
  // tier-2 secret-using tools pass credentials here, so leaking them to
  // the execution row would defeat the whole isolation strategy. The
  // command string should reference env vars by name ($TOKEN), not
  // interpolate values.
  env?:        Record<string, string>
  // Mount mode for the workspace bind mount. Defaults to 'rw' (tier-1).
  // Tier-2 secret-using tools use 'ro' or 'none'.
  mount?:      'rw' | 'ro' | 'none'
}): { id: string; emitter: RunHandle['emitter'] } {
  const { command, session_id, tool_name, tool_input, timeout_ms = config.sandboxTimeout, memory_mb, network = false, env = {}, mount = 'rw' } = input
  const row = database.executionInsert(db, {
    session_id: session_id ?? null, tool_name: tool_name ?? null,
    tool_input: tool_input !== undefined ? JSON.stringify(tool_input) : null,
    command,
    status: 'running', timeout_ms, memory_mb: memory_mb ?? null,
    started_at: now(),
  })
  const workspace = input.workspace ?? `/tmp/foundry-exec-${row.id}`
  mkdirSync(workspace, { recursive: true })
  const handle = spawnRun({
    command, workspace,
    image: config.sandboxImage, env,
    network, mount, timeoutMs: timeout_ms,
    memoryMb:   memory_mb ?? config.sandboxMemoryMb,
    cpus:       config.sandboxCpus,
    pidsLimit:  config.sandboxPidsLimit,
    nofileSoft: config.sandboxNofileSoft,
    nofileHard: config.sandboxNofileHard,
    tmpfsMb:    config.sandboxTmpfsMb,
  })
  const startTime = Date.now()
  activeRuns.set(row.id, handle)
  const stdoutBuf: string[] = []
  const stderrBuf: string[] = []
  handle.emitter.on('stdout', (line: string) => stdoutBuf.push(line))
  handle.emitter.on('stderr', (line: string) => stderrBuf.push(line))
  handle.emitter.on('exit', (code: number, stats: import('./runtime/sandbox.js').ContainerStats | null) => {
    database.executionUpdate(db, row.id, {
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
}

export function executionKill(db: Db, id: string): { ok: true } {
  assertStatus(require(database.executionGet(db, id)), 'running', 'execution is not active')
  const handle = activeRuns.get(id)
  if (handle) { handle.kill(); activeRuns.delete(id) }
  database.executionUpdate(db, id, { status: 'failed', exit_code: -1, ended_at: now() })
  return { ok: true }
}

export function executionStream(db: Db, id: string, res: Response): void {
  const row = require(database.executionGet(db, id))
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  function sse(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

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
}

// ════════════════════════════════════════════════════════════════════════════
// USAGE ROLLUPS
// ════════════════════════════════════════════════════════════════════════════

export interface TicketChainEntry {
  id: string; title: string; body: string
  agent_id: string | null; status: string
}

export interface UsageRollup {
  session_count: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
  step_count: number
  tool_calls: number
  exec_count: number
  cpu_ms: number
  peak_memory_mb: number | null
  net_bytes: number
}

function rollupExecutions(executions: Execution[]): { exec_count: number; cpu_ms: number; peak_memory_mb: number | null; net_bytes: number } {
  let cpu_ms = 0, net_bytes = 0, peak = 0
  for (const e of executions) {
    cpu_ms += e.cpu_ms ?? 0
    net_bytes += (e.net_rx_bytes ?? 0) + (e.net_tx_bytes ?? 0)
    if ((e.peak_memory_mb ?? 0) > peak) peak = e.peak_memory_mb ?? 0
  }
  return { exec_count: executions.length, cpu_ms, peak_memory_mb: peak || null, net_bytes }
}

interface SessionUsageRow {
  id:          string
  duration_ms: number | null
  tokens_in:   number | null
  tokens_out:  number | null
  step_count:  number | null
  tool_calls:  number | null
}

function rollupSessions(db: Db, sessions: SessionUsageRow[]): UsageRollup {
  let tokens_in = 0, tokens_out = 0, duration_ms = 0, step_count = 0, tool_calls = 0
  let cpu_ms = 0, net_bytes = 0, peak = 0, exec_count = 0
  for (const s of sessions) {
    tokens_in   += s.tokens_in   ?? 0
    tokens_out  += s.tokens_out  ?? 0
    duration_ms += s.duration_ms ?? 0
    step_count  += s.step_count  ?? 0
    tool_calls  += s.tool_calls  ?? 0
    const e = rollupExecutions(database.executionBySession(db, s.id))
    cpu_ms    += e.cpu_ms
    net_bytes += e.net_bytes
    exec_count += e.exec_count
    if ((e.peak_memory_mb ?? 0) > peak) peak = e.peak_memory_mb ?? 0
  }
  return {
    session_count: sessions.length,
    tokens_in, tokens_out, duration_ms, step_count, tool_calls,
    exec_count, cpu_ms, peak_memory_mb: peak || null, net_bytes,
  }
}

export function ticketUsage(db: Db, id: string): UsageRollup {
  require(database.ticketGet(db, id))
  return rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.ticket_id, id)]))
}

export function agentUsage(db: Db, id: string): UsageRollup {
  require(database.agentGet(db, id))
  return rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.agent_id, id)]))
}

export function sessionUsage(db: Db, id: string): UsageRollup {
  const s = require(database.sessionGetAggregated(db, id))
  return rollupSessions(db, [s])
}
