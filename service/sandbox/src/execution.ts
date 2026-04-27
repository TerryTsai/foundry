import type { Response } from 'express'
import { EventEmitter } from 'events'
import { ulid } from 'ulid'

import type { Execution } from '@foundry/db'
import type { Result, Ctx } from '@foundry/model'
import { ok, err, makeCtx, now } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'

import {
  ensureSessionContainer, execInContainer, stopSessionContainer,
} from './podman.js'
import type {
  SandboxConfig, SandboxState,
  ExecHandle, ExecutionCreateInput, ExecutionCreateResult, SandboxError,
} from './schema.js'

function scrubSecrets(s: string | null | undefined): string | null {
  if (!s) return s ?? null
  return s
    .replace(/x-access-token:[^@\s'"]+@/g, 'x-access-token:[REDACTED]@')
    .replace(/Bearer\s+(ghs_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-ant-[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+)/g, 'Bearer [REDACTED]')
}

// Reads — async, ownership check via crud's owned helpers (which check
// project ownership on the way through) plus the raw list/by-session
// internal methods.

export async function executionList(
  ctx: Ctx, crud: CrudClient,
): Promise<Result<Execution[], SandboxError>> {
  const r = await crud.executionList(ctx)
  return r.ok ? ok(r.value) : err({ kind: 'internal', message: r.error.kind })
}

export async function executionBySession(
  ctx: Ctx, crud: CrudClient, sessionId: string,
): Promise<Result<Execution[], SandboxError>> {
  const r = await crud.executionBySession(ctx, sessionId)
  return r.ok ? ok(r.value) : err({ kind: 'internal', message: r.error.kind })
}

// Sync execution creation — used by engine via the in-process mcp tool
// ctx. mcp handlers call this synchronously to get the EventEmitter
// immediately. The actual DB row insert happens fire-and-forget in
// the background; the row id is generated client-side via ulid so it
// can be returned without an await.
export function executionCreate(
  config: SandboxConfig, crud: CrudClient, state: SandboxState, input: ExecutionCreateInput,
): Result<ExecutionCreateResult, SandboxError> {
  if (!input.session_id) {
    return err({ kind: 'validation_failed', field: 'session_id', reason: 'session_id is required for persistent-container execution' })
  }
  return ok(beginExecution(config, crud, state, input.session_id, input))
}

function beginExecution(
  config: SandboxConfig, crud: CrudClient, state: SandboxState,
  sessionId: string, input: ExecutionCreateInput,
): ExecutionCreateResult {
  const timeout_ms = input.timeout_ms ?? config.sandboxTimeout
  const rowId = ulid()
  const outward = new EventEmitter()
  const ctx = makeCtx({ accountId: 'system' })
  void crud.executionMeterCreate(ctx, executionRowData(rowId, sessionId, input, timeout_ms))
  void runInContainer(ctx, config, crud, state, sessionId, input, rowId, timeout_ms, outward)
  return { id: rowId, emitter: outward }
}

function executionRowData(rowId: string, sessionId: string, input: ExecutionCreateInput, timeout_ms: number) {
  return {
    id:          rowId,
    session_id:  sessionId,
    tool_name:   input.tool_name   ?? null,
    tool_input:  input.tool_input !== undefined ? JSON.stringify(input.tool_input) : null,
    tool_use_id: input.tool_use_id ?? null,
    command:     input.command,
    status:      'running',
    timeout_ms,
    memory_mb:   null,
    started_at:  now(),
  }
}

async function runInContainer(
  ctx: Ctx, config: SandboxConfig, crud: CrudClient, state: SandboxState,
  sessionId: string, input: ExecutionCreateInput, rowId: string, timeout_ms: number, outward: EventEmitter,
): Promise<void> {
  const startTime = Date.now()
  try {
    const handle = await launchExec(config, state, sessionId, input, timeout_ms)
    state.activeExecs.set(rowId, handle)
    wireExecHandlers(ctx, crud, state, rowId, handle, outward, startTime)
  } catch (errIn) {
    finalizeExecFailure(ctx, crud, rowId, errIn, startTime, outward)
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
  ctx: Ctx, crud: CrudClient, state: SandboxState, rowId: string,
  handle: ExecHandle, outward: EventEmitter, startTime: number,
): void {
  const stdout: string[] = []
  const stderr: string[] = []
  handle.emitter.on('stdout', (s: string) => { stdout.push(s); outward.emit('stdout', s) })
  handle.emitter.on('stderr', (s: string) => { stderr.push(s); outward.emit('stderr', s) })
  handle.emitter.once('exit', (code: number, stats) => {
    state.activeExecs.delete(rowId)
    void crud.executionMeterUpdate(ctx, rowId, finalizePayload(code, stats, stdout, stderr, startTime))
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
  ctx: Ctx, crud: CrudClient, rowId: string, errVal: unknown, startTime: number, outward: EventEmitter,
): void {
  const msg = errVal instanceof Error ? errVal.message : String(errVal)
  void crud.executionMeterUpdate(ctx, rowId, {
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

export async function executionKill(
  ctx: Ctx, crud: CrudClient, id: string, state: SandboxState,
): Promise<Result<{ ok: true }, SandboxError>> {
  // Best-effort: route handlers gate by ownership; we just kill the
  // active handle if present and mark cancelled.
  killOne(ctx, crud, state, id)
  return ok({ ok: true })
}

function killOne(ctx: Ctx, crud: CrudClient, state: SandboxState, id: string): void {
  const handle = state.activeExecs.get(id)
  if (handle) { handle.kill(); state.activeExecs.delete(id) }
  void crud.executionMarkCancelled(ctx, id)
}

// Called on ticket cancel. Tearing down each running session's container
// kills its chromium, dev servers, and every in-flight exec in one shot.
export async function killRunningExecutionsForTicket(
  ctx: Ctx, crud: CrudClient, state: SandboxState, ticketId: string,
): Promise<void> {
  const r = await crud.sessionsByTicketRaw(ctx, ticketId)
  if (!r.ok) return
  for (const s of r.value) {
    if (s.status !== 'running') continue
    await killSessionExecs(ctx, crud, state, s.id)
    void stopSessionContainer(state, s.id)
  }
}

async function killSessionExecs(ctx: Ctx, crud: CrudClient, state: SandboxState, sessionId: string): Promise<void> {
  const r = await crud.executionBySession(ctx, sessionId)
  if (!r.ok) return
  for (const e of r.value) if (e.status === 'running') killOne(ctx, crud, state, e.id)
}

export function executionStream(
  id: string, res: Response, state: SandboxState,
): Result<void, SandboxError> {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  return streamExec(res, id, state)
}

function streamExec(res: Response, id: string, state: SandboxState): Result<void, SandboxError> {
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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
