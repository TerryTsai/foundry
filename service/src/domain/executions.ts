import type { Response } from 'express'
import { sql } from 'drizzle-orm'

import { type Db } from '../database.js'
import * as database from '../database.js'
import type { Execution } from '../tables.js'
import type { Config } from '../config.js'
import { mustExist, assertStatus, now } from '../util.js'
import { spawnRun, type RunHandle } from '../runtime/podman.js'
import { prepareWorkspace } from '../runtime/workspace.js'
import { onExecutionExit } from '../runtime/exit-handler.js'

const activeRuns = new Map<string, RunHandle>()

export function executionList(db: Db): Execution[] {
  return database.executionAll(db).reverse().slice(0, 200)
}

export function executionGet(db: Db, id: string): Execution {
  return mustExist(database.executionGet(db, id))
}

export function executionBySession(db: Db, sessionId: string): Execution[] {
  mustExist(database.sessionGet(db, sessionId))
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
}): { id: string; emitter: RunHandle['emitter'] } {
  const { command, session_id, tool_name, tool_input, tool_use_id,
          timeout_ms = config.sandboxTimeout, memory_mb,
          network = false, env = {}, mount = 'rw', artifactsIn, artifactsOut } = input
  const row = database.executionInsert(db, {
    session_id:  session_id  ?? null,
    tool_name:   tool_name   ?? null,
    tool_input:  tool_input !== undefined ? JSON.stringify(tool_input) : null,
    tool_use_id: tool_use_id ?? null,
    command, status: 'running', timeout_ms, memory_mb: memory_mb ?? null,
    started_at: now(),
  })
  backfillActivityExecutionId(db, row.id, tool_use_id, session_id)

  const dirs = prepareWorkspace({ executionId: row.id, workspace: input.workspace, artifactsIn, artifactsOut })
  const handle = spawnRun({
    command, workspace: dirs.workspace, statsDir: dirs.statsDir,
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
    onExecutionExit(db, { executionId: row.id, startTime, dirs, artifactsOut, stdout, stderr }, code, stats)
    activeRuns.delete(row.id)
  })
  return { id: row.id, emitter: handle.emitter }
}

// Link a pre-existing tool_call activity row to the new execution. The
// runner writes the activity when the model streams the tool_use block,
// before the MCP handler fires — so the link needs filling in.
function backfillActivityExecutionId(db: Db, executionId: string, toolUseId?: string, sessionId?: string): void {
  if (!toolUseId || !sessionId) return
  db.run(sql`
    UPDATE activity SET execution_id = ${executionId}
     WHERE session_id = ${sessionId} AND tool_use_id = ${toolUseId} AND execution_id IS NULL
  `)
}

export function executionKill(db: Db, id: string): { ok: true } {
  assertStatus(mustExist(database.executionGet(db, id)), 'running', 'execution is not active')
  const handle = activeRuns.get(id)
  if (handle) { handle.kill(); activeRuns.delete(id) }
  database.executionUpdate(db, id, { status: 'failed', exit_code: -1, ended_at: now() })
  return { ok: true }
}

export function executionStream(db: Db, id: string, res: Response): void {
  const row = mustExist(database.executionGet(db, id))
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
