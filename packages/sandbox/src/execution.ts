import type { Response } from 'express'
import { EventEmitter } from 'events'

import { type Db } from '@foundry/db'
import type { Execution, Session } from '@foundry/db'
import { mustExist, assertStatus, now } from '@foundry/model'

import {
  ensureSessionContainer, execInContainer, stopSessionContainer, type ExecHandle,
} from './podman.js'
import type { SandboxConfig, SandboxCrudOps } from './types.js'

// Cross-module ownership-check callbacks injected by the route layer.
// sandbox can't import @foundry/crud (no logic-to-logic). The composition
// root binds these to the crud helpers it already has.
export type IsExecutionOwned = (db: Db, executionId: string, accountId: string) => Execution
export type IsSessionOwned   = (db: Db, sessionId: string,   accountId: string) => Session

// Track live exec handles so we can kill in-flight commands on ticket
// cancel. Container teardown also kills them, but explicit kills give
// a cleaner exit code trail.
const activeExecs = new Map<string, ExecHandle>()

// ── Secret scrubbing ──────────────────────────────────────────────────
//
// stdout/stderr from sandbox executions can leak secrets the agent
// passed via env. Run a regex pass over the captured output before
// persisting the execution row. The patterns cover URL-embedded
// install tokens and Bearer tokens for common providers.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/x-access-token:[^@\s'"]+@/g, 'x-access-token:[REDACTED]@'],
  [/Bearer\s+(ghs_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)/g, 'Bearer [REDACTED]'],
]

function scrubSecrets(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  let out = s
  for (const [pat, rep] of SECRET_PATTERNS) out = out.replace(pat, rep)
  return out
}

export function executionList(
  db: Db, accountId: string, crud: SandboxCrudOps,
): Execution[] {
  return crud.executionList(db, accountId)
}

export function executionGet(
  db: Db, accountId: string, id: string, isExecutionOwned: IsExecutionOwned,
): Execution {
  return isExecutionOwned(db, id, accountId)
}

export function executionBySession(
  db: Db, accountId: string, sessionId: string,
  isSessionOwned: IsSessionOwned, crud: SandboxCrudOps,
): Execution[] {
  isSessionOwned(db, sessionId, accountId)
  return crud.executionBySession(db, sessionId)
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
// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function executionCreate(
  db: Db, config: SandboxConfig, crud: SandboxCrudOps, input: ExecutionCreateInput,
): { id: string; emitter: ExecHandle['emitter'] } {
  if (!input.session_id) {
    throw new Error('executionCreate: session_id is required for persistent-container execution')
  }
  const sessionId = input.session_id
  // Resolve the session's workspace (set up once by withWorkspace) so
  // startSessionContainer can bind-mount it. Sessions always have a
  // workspace by the time they make a tool call.
  const session = mustExist(crud.sessionGetById(db, sessionId))
  void session // for future use; right now just validates existence

  const timeout_ms = input.timeout_ms ?? config.sandboxTimeout

  const row = crud.executionMeterCreate(db, {
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
        crud.executionMeterUpdate(db, row.id, {
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
      crud.executionMeterUpdate(db, row.id, {
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

export function executionKill(
  db: Db, accountId: string, id: string,
  isExecutionOwned: IsExecutionOwned, crud: SandboxCrudOps,
): { ok: true } {
  const row = isExecutionOwned(db, id, accountId)
  assertStatus(row, 'running', 'execution is not active')
  killOne(db, id, crud)
  return { ok: true }
}

function killOne(db: Db, id: string, crud: SandboxCrudOps): void {
  const handle = activeExecs.get(id)
  if (handle) { handle.kill(); activeExecs.delete(id) }
  crud.executionMarkCancelled(db, id)
}

// Called on ticket cancel. Tearing down each running session's
// container kills its chromium, its dev servers, and every in-flight
// exec in one shot — no need to walk executions individually.
export function killRunningExecutionsForTicket(
  db: Db, ticketId: string, crud: SandboxCrudOps,
): void {
  const sessions = crud.sessionsForTicketRaw(db, ticketId)
  for (const s of sessions) {
    if (s.status !== 'running') continue
    // Best-effort: mark any live exec rows for this session as cancelled,
    // then kill the container so chromium / dev servers / anything still
    // running inside dies cleanly.
    const execs = crud.executionBySession(db, s.id)
    for (const e of execs) {
      if (e.status === 'running') killOne(db, e.id, crud)
    }
    void stopSessionContainer(s.id)
  }
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function executionStream(
  db: Db, accountId: string, id: string, res: Response, isExecutionOwned: IsExecutionOwned,
): void {
  const row = isExecutionOwned(db, id, accountId)
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
