// Module-internal types for @foundry/reconciler.
//
// Reconciler cannot import other logic modules (crud/engine/auth/mcp/
// sandbox) — see ARCHITECTURE.md. All cross-module functions arrive via
// ReconcilerDeps, constructed at the composition root.

import type { Db } from '@foundry/db'
import type { Agent, Event, Project, Session, Ticket } from '@foundry/db'

// ── ReconcilerConfig ─────────────────────────────────────────────────
// Reconciler itself never inspects config — it threads it into the
// engine's runSession callback. The interface mirrors the slice of the
// service Config that runSession's downstream consumers (engine, mcp,
// sandbox) need; structural typing keeps the actual service Config
// assignable here.

export interface ReconcilerConfig {
  sandboxTimeout:        number
  port:                  number
  sandboxImage:          string
  sandboxMemoryMb:       number
  sandboxCpus:           number
  sandboxPidsLimit:      number
  sandboxNofileSoft:     number
  sandboxNofileHard:     number
  sandboxTmpfsMb:        number
  internalApiToken:      string
  // Threaded through to engine → mcp's github tools. Reconciler never
  // reads them; they're on the type so the same service Config object
  // is assignable to both ReconcilerConfig and engine's EngineConfig.
  gitHubAppId?:          number
  gitHubAppPrivateKey?:  string
  gitHubClientId:        string
  gitHubClientSecret:    string
}

// ── EngineDeps (opaque pass-through) ─────────────────────────────────
// Reconciler cannot import @foundry/engine, but it also doesn't read or
// inspect EngineDeps — it just threads the bag the composition root
// built into runSession. Modeling it as an opaque brand keeps reconciler
// from accidentally peeking into engine internals, while the composition
// root performs an explicit cast where the brand is applied.

declare const engineDepsBrand: unique symbol
export interface EngineDeps { readonly [engineDepsBrand]: never }

// ── runSession (structural callback) ─────────────────────────────────
// Mirrors @foundry/engine's runSession signature. The composition root
// passes engine.runSession in directly.

// Engine.runSession returns Result<void, EngineError>; reconciler treats
// it as fire-and-forget but still needs to handle errors. Structural type
// to keep reconciler module-agnostic.
export type RunSessionFn = (
  db:        Db,
  config:    ReconcilerConfig,
  deps:     EngineDeps,
  sessionId: string,
  agent:     Agent,
  ticket:    Ticket,
  role:      'producer' | 'verifier',
) => Promise<{ ok: true; value: void } | { ok: false; error: { kind: string; message?: string } }>

// ── crud callbacks ──────────────────────────────────────────────────
// Reconciler depends on crud for read/write of tickets, sessions,
// agents, events. All persistence goes through this bag.

export interface VerdictRow {
  id:         string
  session_id: string
  agent_id:   string
  ticket_id:  string
  pass:       boolean
  reason:     string
  created_at: string
}

export interface ReconcilerCrudOps {
  agentList:               (db: Db, opts: { accountId: string }) => Agent[]
  projectsActive:          (db: Db) => Project[]
  ticketAllByProject:      (db: Db, projectId: string, status: string) => Ticket[]
  ticketGetById:           (db: Db, id: string) => Ticket | undefined
  ticketTransition:        (db: Db, id: string, from: string, to: string) => boolean
  ticketUpdateById:        (db: Db, id: string, data: Record<string, unknown>) => Ticket
  sessionInsert:           (db: Db, data: Record<string, unknown>) => Session
  sessionUpdateById:       (db: Db, id: string, data: Record<string, unknown>) => Session
  sessionRunning:          (db: Db) => Session[]
  sessionRunningForTicket: (db: Db, ticketId: string) => Session[]
  sessionsByTicketRaw:     (db: Db, ticketId: string) => Session[]
  verdictBySession:        (db: Db, sessionId: string) => VerdictRow | undefined
  eventCreate:             (db: Db, data: { entity_type: string; entity_id: string; kind: string; data?: string; caused_by: string; caused_by_id?: string | null }) => Event
  eventLatest:             (db: Db, entityType: string, entityId: string) => Event | undefined
}

// ── ReconcilerDeps ──────────────────────────────────────────────────
// Single bundle of every cross-module function the reconciler needs.
// Composition root constructs this once per service boot.

export interface ReconcilerDeps {
  config: ReconcilerConfig
  crud:   ReconcilerCrudOps
  engine: {
    runSession: RunSessionFn
    engineDeps: EngineDeps
  }
}

// ── Policy ───────────────────────────────────────────────────────────
// Each policy receives the same context: the project being reconciled,
// its agents, the ticket under consideration, and a mutable slots
// counter (decremented by dispatching policies as they consume a slot).
//
// 'acted'  → policy made a state change for this ticket; reconciler
//            stops walking the policy list for this tick.
// 'pass'   → policy was not applicable; reconciler tries the next.

export interface PolicyCtx {
  db:      Db
  deps:    ReconcilerDeps
  project: Project
  agents:  Agent[]
  ticket:  Ticket
  slots:   { remaining: number }   // mutable across policies/tickets within a project tick
}

export type Policy = (ctx: PolicyCtx) => 'acted' | 'pass'

// ── Error union ─────────────────────────────────────────────────────

export type ReconcilerError =
  | { kind: 'internal'; message: string }
