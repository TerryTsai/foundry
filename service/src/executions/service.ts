import type { Response } from 'express'
import { EventEmitter } from 'events'
import { eq } from 'drizzle-orm'

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import type { Execution } from '../core/schema.js'
import type { Config } from '../core/config.js'
import { mustExist, assertStatus, now } from '../core/util.js'
import { scrubSecrets } from '../integrations/shared.js'
import {
  ensureSessionContainer, execInContainer, stopSessionContainer, type ExecHandle,
} from '../reconciler/session/sandbox/podman.js'
import { executionOwned, sessionOwned } from '../projects/service.js'
import * as schema from '../core/schema.js'

// Track live exec handles so we can kill in-flight commands on ticket
// cancel. Container teardown also kills them, but explicit kills give
// a cleaner exit code trail.
const activeExecs = new Map<string, ExecHandle>()

export function executionList(db: Db, accountId: string): Execution[] {
  // Restrict to executions whose session sits in a project the requester
  // owns. Walk the join in JS — execution volume is bounded (last 200).
  const owned = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  if (owned.length === 0) return []
  const ownedSet = new Set(owned)
  return database.executionAll(db).reverse().filter(e => {
    if (!e.session_id) return false
    const s = database.sessionGet(db, e.session_id)
    if (!s) return false
    const t = database.ticketGet(db, s.ticket_id)
    return t ? ownedSet.has(t.project_id) : false
  }).slice(0, 200)
}

export function executionGet(db: Db, accountId: string, id: string): Execution {
  return executionOwned(db, id, accountId)
}

export function executionBySession(db: Db, accountId: string, sessionId: string): Execution[] {
  sessionOwned(db, sessionId, accountId)
  return database.executionBySession(db, sessionId)
}

export interface ExecutionCreateInput {
  command:     string
  session_id?: string
  tool_name?:  string
  tool_input?: unknown
  tool_use_id?: string
  timeout_ms?: number
  /** Env vars passed to the exec (including secrets — curl handlers
   *  reference them as `$TOKEN` etc. instead of reading from a
   *  mounted secrets dir). Values are scrubbed from stdout/stderr
   *  before the execution row is persisted. */
  env?:         Record<string, string>
}

// Unified execution path — every tool call routes through here. Creates
// the execution row, ensures the session's persistent container is up,
// execs the command, streams stdout/stderr, and finalizes the row
// with cpu/net deltas on exit.
export function executionCreate(
  db: Db, config: Config, input: ExecutionCreateInput,
): { id: string; emitter: ExecHandle['emitter'] } {
  if (!input.session_id) {
    throw new Error('executionCreate: session_id is required for persistent-container execution')
  }
  const sessionId = input.session_id
  // Resolve the session's workspace (set up once by withWorkspace) so
  // startSessionContainer can bind-mount it. Sessions always have a
  // workspace by the time they make a tool call.
  const session = mustExist(database.sessionGet(db, sessionId))
  void session // for future use; right now just validates existence

  const timeout_ms = input.timeout_ms ?? config.sandboxTimeout

  const row = database.executionInsert(db, {
    session_id:  sessionId,
    tool_name:   input.tool_name   ?? null,
    tool_input:  input.tool_input !== undefined ? JSON.stringify(input.tool_input) : null,
    tool_use_id: input.tool_use_id ?? null,
    command:     input.command,
    status:      'running',
    timeout_ms,
    memory_mb:   null,
    started_at:  now(),
  })

  const startTime = Date.now()
  const stdout: string[] = []
  const stderr: string[] = []

  // Proxy emitter returned synchronously — streaming endpoint and
  // handler callers attach listeners before the container is up.
  const outward = new EventEmitter()

  // Start the exec asynchronously so we can return the emitter
  // synchronously — streaming consumers register listeners on outward
  // before the container is necessarily up.
  void (async () => {
    try {
      const containerName = await ensureSessionContainer({
        sessionId,
        workspace:  sessionWorkspaceDir(sessionId),
        image:      config.sandboxImage,
        memoryMb:   config.sandboxMemoryMb,
        cpus:       config.sandboxCpus,
        pidsLimit:  config.sandboxPidsLimit,
        nofileSoft: config.sandboxNofileSoft,
        nofileHard: config.sandboxNofileHard,
        tmpfsMb:    config.sandboxTmpfsMb,
      })
      const handle = execInContainer(containerName, input.command, {
        timeoutMs: timeout_ms,
        env:       input.env,
      })
      activeExecs.set(row.id, handle)
      handle.emitter.on('stdout', (s: string) => { stdout.push(s); outward.emit('stdout', s) })
      handle.emitter.on('stderr', (s: string) => { stderr.push(s); outward.emit('stderr', s) })
      handle.emitter.once('exit', (code: number, stats) => {
        activeExecs.delete(row.id)
        database.executionUpdate(db, row.id, {
          status:         code === 0 ? 'finished' : 'failed',
          exit_code:      code,
          ended_at:       now(),
          duration_ms:    Date.now() - startTime,
          stdout:         scrubSecrets(stdout.join('')) || null,
          stderr:         scrubSecrets(stderr.join('')) || null,
          exit_signal:    stats?.exitSignal    ?? null,
          cpu_ms:         stats?.cpuMs         ?? null,
          net_rx_bytes:   stats?.netRxBytes    ?? null,
          net_tx_bytes:   stats?.netTxBytes    ?? null,
        })
        outward.emit('exit', code)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      database.executionUpdate(db, row.id, {
        status:      'failed',
        exit_code:   -1,
        ended_at:    now(),
        duration_ms: Date.now() - startTime,
        stderr:      msg,
      })
      outward.emit('stderr', msg)
      outward.emit('exit', -1)
      return null
    }
  })()

  return { id: row.id, emitter: outward }
}

// Map session_id → workspace host path. Set by the session runner (see
// pipeline/workspace.ts) before any tool call; tools in-flight always
// have a valid entry here. Keyed by session id rather than threaded
// through every call site.
const sessionWorkspaces = new Map<string, string>()

export function registerSessionWorkspace(sessionId: string, workspace: string): void {
  sessionWorkspaces.set(sessionId, workspace)
}
export function unregisterSessionWorkspace(sessionId: string): void {
  sessionWorkspaces.delete(sessionId)
}
function sessionWorkspaceDir(sessionId: string): string {
  const w = sessionWorkspaces.get(sessionId)
  if (!w) throw new Error(`no workspace registered for session ${sessionId}`)
  return w
}

export function executionKill(db: Db, accountId: string, id: string): { ok: true } {
  const row = executionOwned(db, id, accountId)
  assertStatus(row, 'running', 'execution is not active')
  killOne(db, id)
  return { ok: true }
}

function killOne(db: Db, id: string): void {
  const handle = activeExecs.get(id)
  if (handle) { handle.kill(); activeExecs.delete(id) }
  database.executionUpdate(db, id, { status: 'cancelled', exit_code: -1, ended_at: now() })
}

// Called on ticket cancel. Tearing down each running session's
// container kills its chromium, its dev servers, and every in-flight
// exec in one shot — no need to walk executions individually.
export function killRunningExecutionsForTicket(db: Db, ticketId: string): void {
  const sessions = database.sessionsByTicketRaw(db, ticketId)
  for (const s of sessions) {
    if (s.status !== 'running') continue
    // Best-effort: mark any live exec rows for this session as cancelled,
    // then kill the container so chromium / dev servers / anything still
    // running inside dies cleanly.
    const execs = database.executionBySession(db, s.id)
    for (const e of execs) {
      if (e.status === 'running') killOne(db, e.id)
    }
    void stopSessionContainer(s.id)
  }
}

export function executionStream(db: Db, accountId: string, id: string, res: Response): void {
  const row = executionOwned(db, id, accountId)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  if (row.status !== 'running') { sse('exit', { code: row.exit_code ?? -1 }); res.end(); return }

  const handle = activeExecs.get(id)
  if (!handle) { sse('exit', { code: -1 }); res.end(); return }

  const onStdout = (s: string) => sse('stdout', { line: s })
  const onStderr = (s: string) => sse('stderr', { line: s })
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
