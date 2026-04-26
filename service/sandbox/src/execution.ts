import type { Response } from 'express'
import { EventEmitter } from 'events'

import { type Db } from '@foundry/db'
import type { Execution } from '@foundry/db'
import type { Result } from '@foundry/model'
import { ok, err, now } from '@foundry/model'

import {
  ensureSessionContainer, execInContainer, stopSessionContainer,
} from './podman.js'
import type {
  SandboxConfig, SandboxCrudOps, SandboxState,
  ExecHandle, ExecutionCreateInput, ExecutionCreateResult,
  IsExecutionOwned, IsSessionOwned, SandboxError,
} from './schema.js'

function scrubSecrets(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  return s
    .replace(/x-access-token:[^@\s'"]+@/g, 'x-access-token:[REDACTED]@')
    .replace(/Bearer\s+(ghs_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)/g, 'Bearer [REDACTED]')
}

function ownErr(reason: string): SandboxError { return { kind: 'permission_denied', reason } }

function liftOwn<T>(r: Result<T, { kind: string }>): Result<T, SandboxError> {
  if (r.ok) return r
  if (r.error.kind === 'not_found') return err({ kind: 'not_found', id: '' } as SandboxError)
  return err(ownErr('owner check failed'))
}

export function executionList(
  db: Db, accountId: string, crud: SandboxCrudOps,
): Result<Execution[], SandboxError> {
  return ok(crud.executionList(db, accountId))
}

export function executionGet(
  db: Db, accountId: string, id: string, isExecutionOwned: IsExecutionOwned,
): Result<Execution, SandboxError> {
  return liftOwn(isExecutionOwned(db, id, accountId))
}

export function executionBySession(
  db: Db, accountId: string, sessionId: string,
  isSessionOwned: IsSessionOwned, crud: SandboxCrudOps,
): Result<Execution[], SandboxError> {
  const owned = liftOwn(isSessionOwned(db, sessionId, accountId))
  if (!owned.ok) return owned
  return ok(crud.executionBySession(db, sessionId))
}

// Unified execution path — every tool call routes through here. Creates
// the execution row, ensures the persistent container is up, execs the
// command, streams stdout/stderr, finalizes the row on exit.
export function executionCreate(
  db: Db, config: SandboxConfig, crud: SandboxCrudOps, state: SandboxState, input: ExecutionCreateInput,
): Result<ExecutionCreateResult, SandboxError> {
  if (!input.session_id) {
    return err({ kind: 'validation_failed', field: 'session_id', reason: 'session_id is required for persistent-container execution' })
  }
  const sessionId = input.session_id
  if (!crud.sessionGetById(db, sessionId)) {
    return err({ kind: 'not_found', id: sessionId })
  }
  return ok(beginExecution(db, config, crud, state, sessionId, input))
}

function beginExecution(
  db: Db, config: SandboxConfig, crud: SandboxCrudOps, state: SandboxState,
  sessionId: string, input: ExecutionCreateInput,
): ExecutionCreateResult {
  const timeout_ms = input.timeout_ms ?? config.sandboxTimeout
  const row = createExecutionRow(crud, db, sessionId, input, timeout_ms)
  const outward = new EventEmitter()
  void runInContainer(db, config, crud, state, sessionId, input, row.id, timeout_ms, outward)
  return { id: row.id, emitter: outward }
}

function createExecutionRow(
  crud: SandboxCrudOps, db: Db, sessionId: string, input: ExecutionCreateInput, timeout_ms: number,
): Execution {
  return crud.executionMeterCreate(db, {
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
}

async function runInContainer(
  db: Db, config: SandboxConfig, crud: SandboxCrudOps, state: SandboxState,
  sessionId: string, input: ExecutionCreateInput, rowId: string, timeout_ms: number, outward: EventEmitter,
): Promise<void> {
  const startTime = Date.now()
  try {
    const handle = await launchExec(config, state, sessionId, input, timeout_ms)
    state.activeExecs.set(rowId, handle)
    wireExecHandlers(db, crud, state, rowId, handle, outward, startTime)
  } catch (errIn) {
    finalizeExecFailure(db, crud, rowId, errIn, startTime, outward)
  }
}

async function launchExec(
  config: SandboxConfig, state: SandboxState, sessionId: string, input: ExecutionCreateInput, timeout_ms: number,
): Promise<ExecHandle> {
  const containerName = await ensureSessionContainer(state, {
    sessionId,
    workspace:  sessionWorkspaceDir(state, sessionId),
    image:      config.sandboxImage,
    memoryMb:   config.sandboxMemoryMb,
    cpus:       config.sandboxCpus,
    pidsLimit:  config.sandboxPidsLimit,
    nofileSoft: config.sandboxNofileSoft,
    nofileHard: config.sandboxNofileHard,
    tmpfsMb:    config.sandboxTmpfsMb,
  })
  return execInContainer(containerName, input.command, { timeoutMs: timeout_ms, env: input.env })
}

function wireExecHandlers(
  db: Db, crud: SandboxCrudOps, state: SandboxState, rowId: string,
  handle: ExecHandle, outward: EventEmitter, startTime: number,
): void {
  const stdout: string[] = []
  const stderr: string[] = []
  handle.emitter.on('stdout', (s: string) => { stdout.push(s); outward.emit('stdout', s) })
  handle.emitter.on('stderr', (s: string) => { stderr.push(s); outward.emit('stderr', s) })
  handle.emitter.once('exit', (code: number, stats) => {
    state.activeExecs.delete(rowId)
    crud.executionMeterUpdate(db, rowId, finalizePayload(code, stats, stdout, stderr, startTime))
    outward.emit('exit', code)
  })
}

function finalizePayload(
  code: number, stats: { exitSignal?: string | null; cpuMs?: number | null; netRxBytes?: number | null; netTxBytes?: number | null } | undefined,
  stdout: string[], stderr: string[], startTime: number,
): Record<string, unknown> {
  return {
    status:       code === 0 ? 'finished' : 'failed',
    exit_code:    code,
    ended_at:     now(),
    duration_ms:  Date.now() - startTime,
    stdout:       scrubSecrets(stdout.join('')) || null,
    stderr:       scrubSecrets(stderr.join('')) || null,
    exit_signal:  stats?.exitSignal  ?? null,
    cpu_ms:       stats?.cpuMs       ?? null,
    net_rx_bytes: stats?.netRxBytes  ?? null,
    net_tx_bytes: stats?.netTxBytes  ?? null,
  }
}

function finalizeExecFailure(
  db: Db, crud: SandboxCrudOps, rowId: string, errVal: unknown, startTime: number, outward: EventEmitter,
): void {
  const msg = errVal instanceof Error ? errVal.message : String(errVal)
  crud.executionMeterUpdate(db, rowId, {
    status: 'failed', exit_code: -1, ended_at: now(),
    duration_ms: Date.now() - startTime, stderr: msg,
  })
  outward.emit('stderr', msg)
  outward.emit('exit', -1)
}

export function registerSessionWorkspace(state: SandboxState, sessionId: string, workspace: string): void {
  state.sessionWorkspaces.set(sessionId, workspace)
}
export function unregisterSessionWorkspace(state: SandboxState, sessionId: string): void {
  state.sessionWorkspaces.delete(sessionId)
}
function sessionWorkspaceDir(state: SandboxState, sessionId: string): string {
  const w = state.sessionWorkspaces.get(sessionId)
  if (!w) throw new Error(`no workspace registered for session ${sessionId}`)
  return w
}

export function executionKill(
  db: Db, accountId: string, id: string,
  isExecutionOwned: IsExecutionOwned, crud: SandboxCrudOps, state: SandboxState,
): Result<{ ok: true }, SandboxError> {
  const owned = liftOwn(isExecutionOwned(db, id, accountId))
  if (!owned.ok) return owned
  if (owned.value.status !== 'running') return err({ kind: 'conflict', reason: 'execution is not active' })
  killOne(db, id, crud, state)
  return ok({ ok: true })
}

function killOne(db: Db, id: string, crud: SandboxCrudOps, state: SandboxState): void {
  const handle = state.activeExecs.get(id)
  if (handle) { handle.kill(); state.activeExecs.delete(id) }
  crud.executionMarkCancelled(db, id)
}

// Called on ticket cancel. Tearing down each running session's container
// kills its chromium, dev servers, and every in-flight exec in one shot.
export function killRunningExecutionsForTicket(
  db: Db, ticketId: string, crud: SandboxCrudOps, state: SandboxState,
): void {
  const sessions = crud.sessionsForTicketRaw(db, ticketId)
  for (const s of sessions) {
    if (s.status !== 'running') continue
    killSessionExecs(db, crud, state, s.id)
    void stopSessionContainer(state, s.id)
  }
}

function killSessionExecs(db: Db, crud: SandboxCrudOps, state: SandboxState, sessionId: string): void {
  const execs = crud.executionBySession(db, sessionId)
  for (const e of execs) if (e.status === 'running') killOne(db, e.id, crud, state)
}

export function executionStream(
  db: Db, accountId: string, id: string, res: Response, isExecutionOwned: IsExecutionOwned, state: SandboxState,
): Result<void, SandboxError> {
  const owned = liftOwn(isExecutionOwned(db, id, accountId))
  if (!owned.ok) return owned
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  return streamExec(res, owned.value, id, state)
}

function streamExec(res: Response, row: Execution, id: string, state: SandboxState): Result<void, SandboxError> {
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (row.status !== 'running') { sse('exit', { code: row.exit_code ?? -1 }); res.end(); return ok(undefined) }
  const handle = state.activeExecs.get(id)
  if (!handle) { sse('exit', { code: -1 }); res.end(); return ok(undefined) }
  attachSseHandlers(handle, res, sse)
  return ok(undefined)
}

function attachSseHandlers(
  handle: ExecHandle, res: Response,
  sse: (event: string, data: unknown) => void,
): void {
  const onStdout = (s: string) => sse('stdout', { line: s })
  const onStderr = (s: string) => sse('stderr', { line: s })
  const onExit   = (code: number) => { sse('exit', { code }); res.end() }
  handle.emitter.on('stdout', onStdout)
  handle.emitter.on('stderr', onStderr)
  handle.emitter.once('exit', onExit)
  res.on('close', () => detachSseHandlers(handle, onStdout, onStderr, onExit))
}

function detachSseHandlers(
  handle: ExecHandle,
  onStdout: (s: string) => void, onStderr: (s: string) => void, onExit: (code: number) => void,
): void {
  handle.emitter.off('stdout', onStdout)
  handle.emitter.off('stderr', onStderr)
  handle.emitter.off('exit', onExit)
}

// Factory used by the composition root to create the SandboxState bag
// once at boot. Sandbox functions accept the bag by parameter; nothing
// in this module retains module-level state.
export function createSandboxState(): SandboxState {
  return { activeExecs: new Map(), sessionContainers: new Map(), sessionWorkspaces: new Map() }
}
