// Shapes for @foundry/sandbox.
//
// SandboxConfig is the minimal surface of the service-wide Config that
// sandbox needs. The route layer passes the full Config object; TS
// structural typing makes that compatible.

import { z } from 'zod'
import type { Db, Execution, Session } from '@foundry/db'
import type { Result } from '@foundry/model'
import type { ChildProcess } from 'child_process'
import type { EventEmitter } from 'events'

// ── HTTP boundary validators ────────────────────────────────────────

export const executionCreate = z.object({
  command:    z.string().min(1),
  session_id: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
})

export interface SandboxConfig {
  port:               number
  sandboxImage:       string
  sandboxTimeout:     number
  sandboxMemoryMb:    number
  sandboxCpus:        number
  sandboxPidsLimit:   number
  sandboxNofileSoft:  number
  sandboxNofileHard:  number
  sandboxTmpfsMb:     number
  internalApiToken:   string
}

// Cross-module callback bag — sandbox can't import @foundry/crud, so the
// composition root binds these from crud's helpers.

export interface SandboxCrudOps {
  // reads
  sessionGetById:       (db: Db, id: string) => Session | undefined
  executionList:        (db: Db, accountId: string) => Execution[]
  executionBySession:   (db: Db, sessionId: string) => Execution[]
  sessionsForTicketRaw: (db: Db, ticketId: string) => Session[]
  // writes — execution metering
  executionMeterCreate: (db: Db, input: ExecutionMeterCreateInput) => Execution
  executionMeterUpdate: (db: Db, id: string, data: Record<string, unknown>) => Execution
  executionMarkCancelled: (db: Db, id: string) => Execution
}

export interface ExecutionMeterCreateInput {
  session_id?:  string | null
  tool_name?:   string | null
  tool_input?:  string | null
  tool_use_id?: string | null
  command:      string
  status:       string
  timeout_ms:   number
  memory_mb?:   number | null
  started_at:   string
}

// ── Execution interface (per-call) ──────────────────────────────────

export interface ExecutionCreateInput {
  command:      string
  session_id?:  string
  tool_name?:   string
  tool_input?:  unknown
  tool_use_id?: string
  timeout_ms?:  number
  env?:         Record<string, string>
}

export interface ExecutionCreateResult {
  id:      string
  emitter: EventEmitter
}

// Cross-module ownership-check callbacks. Sandbox can't import @foundry/crud;
// the composition root binds these to crud's helpers.
export type IsExecutionOwned = (db: Db, executionId: string, accountId: string) => Result<Execution, { kind: string; entity?: string; id?: string; reason?: string }>
export type IsSessionOwned   = (db: Db, sessionId: string,   accountId: string) => Result<Session,   { kind: string; entity?: string; id?: string; reason?: string }>

// ── Podman primitives ───────────────────────────────────────────────

export interface SessionContainerOpts {
  sessionId:   string
  workspace:   string
  image:       string
  memoryMb:    number
  cpus:        number
  pidsLimit:   number
  nofileSoft:  number
  nofileHard:  number
  tmpfsMb:     number
}

export interface ContainerStats {
  peakMemoryMb: number | null
  cpuMs:        number | null
  netRxBytes:   number | null
  netTxBytes:   number | null
  exitSignal:   string | null
}

export interface ExecHandle {
  emitter: EventEmitter
  kill:    () => void
}

export interface ExecOptions {
  timeoutMs?: number
  env?:       Record<string, string>
}

// Used internally by execInContainer to thread streaming buffers + the
// timed-out flag through nested helpers.
export interface ExecState {
  stdoutBuf: string
  stderrBuf: string
  timedOut:  boolean
}

// ── Runtime state ────────────────────────────────────────────────────
// Sandbox holds three pieces of cross-call state: running `podman exec`
// handles (so KILL can reach in-flight executions), the container name
// for each session (long-lived containers persist across tool calls),
// and the workspace path for each session (looked up at exec start to
// set the bind-mount). Composition root creates one SandboxState at boot
// and threads it into every sandbox function — no module-level state
// lives in the sandbox package.

export interface SandboxState {
  activeExecs:        Map<string, ExecHandle>
  sessionContainers:  Map<string, string>
  sessionWorkspaces:  Map<string, string>
}

// External shape used by ChildProcess-typed helpers. Re-exported so
// feature files don't reach into 'child_process' directly.
export type { ChildProcess }
