// Module-internal types for @foundry/reconciler.
//
// Reconciler cannot import other logic modules (crud/engine/auth/mcp/
// sandbox) — see ARCHITECTURE.md. All cross-module functions arrive via
// ReconcilerDeps, constructed at the composition root.

import type { Db } from '@foundry/db'
import type { Agent, Ticket } from '@foundry/db'

// ── ReconcilerConfig ─────────────────────────────────────────────────
// Reconciler itself never inspects config — it threads it into the
// engine's runSession callback. The interface mirrors the slice of the
// service Config that runSession's downstream consumers (engine, mcp,
// sandbox) need; structural typing keeps the actual service Config
// assignable here.

export interface ReconcilerConfig {
  sandboxTimeout:    number
  port:              number
  sandboxImage:      string
  sandboxMemoryMb:   number
  sandboxCpus:       number
  sandboxPidsLimit:  number
  sandboxNofileSoft: number
  sandboxNofileHard: number
  sandboxTmpfsMb:    number
  internalApiToken:  string
}

// ── EngineDeps (structural mirror) ───────────────────────────────────
// Local structural mirror of @foundry/engine's EngineDeps. Reconciler
// cannot import @foundry/engine; the composition root constructs the
// real EngineDeps and passes it through. TS structural typing makes the
// concrete object assignable to this shape.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mirror of engine's open shapes
export type EngineDeps = any

// ── runSession (structural callback) ─────────────────────────────────
// Mirrors @foundry/engine's runSession signature. The composition root
// passes engine.runSession in directly.

export type RunSessionFn = (
  db:        Db,
  config:    ReconcilerConfig,
  deps:     EngineDeps,
  sessionId: string,
  agent:     Agent,
  ticket:    Ticket,
  role:      'producer' | 'verifier',
) => Promise<void>

// ── crud callbacks ──────────────────────────────────────────────────

export type AgentListFn = (db: Db, opts: { accountId: string }) => Agent[]

// ── ReconcilerDeps ──────────────────────────────────────────────────
// Single bundle of every cross-module function the reconciler needs.
// Composition root constructs this once per service boot.

export interface ReconcilerDeps {
  config: ReconcilerConfig
  crud: {
    agentList: AgentListFn
  }
  engine: {
    runSession: RunSessionFn
    engineDeps: EngineDeps
  }
}
