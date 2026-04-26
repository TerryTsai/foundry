// Module-internal types for @foundry/reconciler.
//
// Reconciler cannot import other logic modules (crud/engine/auth/mcp/
// sandbox) — see ARCHITECTURE.md. All cross-module functions arrive via
// ReconcilerDeps, constructed at the composition root.

import type { Db } from '@foundry/db'
import type { Agent, Event, Project, Session, Ticket } from '@foundry/db'
import type { Ctx, Result } from '@foundry/model'

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
  ctx:       Ctx,
  db:        Db,
  config:    ReconcilerConfig,
  deps:      EngineDeps,
  sessionId: string,
  agent:     Agent,
  ticket:    Ticket,
  role:      'producer' | 'verifier',
) => Promise<{ ok: true; value: void } | { ok: false; error: { kind: string; message?: string } }>

// ── crud callbacks ──────────────────────────────────────────────────
// Reconciler depends on crud for read/write of tickets, sessions,
// agents, events. All persistence goes through this bag, async/Result/
// Ctx-shaped. Optional reads return Result<T | undefined, …> so callers
// branch on .value rather than wrapping not_found in the error channel;
// writes resolve to Result<T, …> on success.

export interface VerdictRow {
  id:         string
  session_id: string
  agent_id:   string
  ticket_id:  string
  pass:       boolean
  reason:     string
  created_at: string
}

export type ReconcilerCrudError = { kind: 'internal'; message: string }

export interface ReconcilerCrudOps {
  agentList:               (ctx: Ctx, opts: { accountId: string }) => Promise<Result<Agent[], ReconcilerCrudError>>
  projectsActive:          (ctx: Ctx) => Promise<Result<Project[], ReconcilerCrudError>>
  ticketAllByProject:      (ctx: Ctx, projectId: string, status: string) => Promise<Result<Ticket[], ReconcilerCrudError>>
  ticketGetById:           (ctx: Ctx, id: string) => Promise<Result<Ticket | undefined, ReconcilerCrudError>>
  ticketTransition:        (ctx: Ctx, id: string, from: string, to: string) => Promise<Result<boolean, ReconcilerCrudError>>
  ticketUpdateById:        (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Ticket, ReconcilerCrudError>>
  sessionInsert:           (ctx: Ctx, data: Record<string, unknown>) => Promise<Result<Session, ReconcilerCrudError>>
  sessionUpdateById:       (ctx: Ctx, id: string, data: Record<string, unknown>) => Promise<Result<Session, ReconcilerCrudError>>
  sessionRunning:          (ctx: Ctx) => Promise<Result<Session[], ReconcilerCrudError>>
  sessionRunningForTicket: (ctx: Ctx, ticketId: string) => Promise<Result<Session[], ReconcilerCrudError>>
  sessionsByTicketRaw:     (ctx: Ctx, ticketId: string) => Promise<Result<Session[], ReconcilerCrudError>>
  verdictBySession:        (ctx: Ctx, sessionId: string) => Promise<Result<VerdictRow | undefined, ReconcilerCrudError>>
  eventCreate:             (ctx: Ctx, data: { entity_type: string; entity_id: string; kind: string; data?: string; caused_by: string; caused_by_id?: string | null }) => Promise<Result<Event, ReconcilerCrudError>>
  eventLatest:             (ctx: Ctx, entityType: string, entityId: string) => Promise<Result<Event | undefined, ReconcilerCrudError>>
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
  ctx:     Ctx
  db:      Db
  deps:    ReconcilerDeps
  project: Project
  agents:  Agent[]
  ticket:  Ticket
  slots:   { remaining: number }   // mutable across policies/tickets within a project tick
}

export type Policy = (ctx: PolicyCtx) => Promise<'acted' | 'pass'>

// ── Error union ─────────────────────────────────────────────────────

export type ReconcilerError =
  | { kind: 'internal'; message: string }
