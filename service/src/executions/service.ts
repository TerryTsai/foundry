import type { Response } from 'express'

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import type { Execution } from '../core/schema.js'
import type { Config } from '../core/config.js'
import { mustExist, assertStatus, now } from '../core/util.js'
import { spawnRun, type RunHandle } from '../reconciler/session/sandbox/podman.js'
import { prepareWorkspace, finishExecution } from '../reconciler/session/sandbox/workspace.js'
import { executionOwned, sessionOwned } from '../projects/service.js'
import { eq } from 'drizzle-orm'
import * as schema from '../core/schema.js'

const activeRuns = new Map<string, RunHandle>()

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

export function executionCreate(db: Db, config: Config, input: {
  command:    string
  session_id?: string
  tool_name?:  string
  tool_input?: unknown
  tool_use_id?: string
  timeout_ms?: number
  memory_mb?:  number
  network?:    boolean
  workspace?:  string
  env?:        Record<string, string>
  mount?:      'rw' | 'ro' | 'none'
  artifactsIn?:  { src: string; dest: string }[]
  artifactsOut?: { src: string; dest: string }[]
  secretFiles?: Record<string, string>
}): { id: string; emitter: RunHandle['emitter'] } {
  const { command, session_id, tool_name, tool_input, tool_use_id,
          timeout_ms = config.sandboxTimeout, memory_mb,
          network = false, env = {}, mount = 'rw', artifactsIn, artifactsOut, secretFiles } = input
  // tool_use_id is the natural join key to the matching activity row.
  // Both tables stamp it at write time — no UPDATE needed, no race.
  // Do NOT treat this as "redundant with activity.tool_use_id" (see
  // schema.ts on execution for the long version).
  const row = database.executionInsert(db, {
    session_id:  session_id  ?? null,
    tool_name:   tool_name   ?? null,
    tool_input:  tool_input !== undefined ? JSON.stringify(tool_input) : null,
    tool_use_id: tool_use_id ?? null,
    command, status: 'running', timeout_ms, memory_mb: memory_mb ?? null,
    started_at: now(),
  })

  const dirs = prepareWorkspace({ executionId: row.id, workspace: input.workspace, artifactsIn, artifactsOut, secretFiles })
  const handle = spawnRun({
    command, workspace: dirs.workspace, statsDir: dirs.statsDir, secretsDir: dirs.secretsDir,
    image: config.sandboxImage, env, network, mount,
    isolated: dirs.isolated, inputDir: dirs.inputDir, outputDir: dirs.outputDir,
    timeoutMs:  timeout_ms,
    memoryMb:   memory_mb ?? config.sandboxMemoryMb,
    cpus:       config.sandboxCpus,
    pidsLimit:  config.sandboxPidsLimit,
    nofileSoft: config.sandboxNofileSoft,
    nofileHard: config.sandboxNofileHard,
    tmpfsMb:    config.sandboxTmpfsMb,
  })
  const startTime = Date.now()
  const stdout: string[] = []
  const stderr: string[] = []
  activeRuns.set(row.id, handle)
  handle.emitter.on('stdout', (line: string) => stdout.push(line))
  handle.emitter.on('stderr', (line: string) => stderr.push(line))
  handle.emitter.on('exit', (code, stats) => {
    finishExecution(db, { executionId: row.id, startTime, dirs, artifactsOut, stdout, stderr }, code, stats)
    activeRuns.delete(row.id)
  })
  return { id: row.id, emitter: handle.emitter }
}

export function executionKill(db: Db, accountId: string, id: string): { ok: true } {
  const row = executionOwned(db, id, accountId)
  assertStatus(row, 'running', 'execution is not active')
  killOne(db, id)
  return { ok: true }
}

function killOne(db: Db, id: string): void {
  const handle = activeRuns.get(id)
  if (handle) { handle.kill(); activeRuns.delete(id) }
  database.executionUpdate(db, id, { status: 'cancelled', exit_code: -1, ended_at: now() })
}

// Kill every in-flight execution belonging to any running session of
// the ticket. Called on ticket cancel so the SDK's in-progress tool
// calls return immediately — the session's shouldStop() poller then
// sees the ticket is no longer running and bails out of its loop.
// No ownership check here; the caller (tickets/service.ts ticketCancel)
// already authorized via ticketOwned.
export function killRunningExecutionsForTicket(db: Db, ticketId: string): void {
  const sessions = database.sessionsByTicketRaw(db, ticketId)
  for (const s of sessions) {
    if (s.status !== 'running') continue
    const execs = database.executionBySession(db, s.id)
    for (const e of execs) {
      if (e.status !== 'running') continue
      killOne(db, e.id)
    }
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
