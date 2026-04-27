// Module-internal types for @foundry/reconciler.
//
// Reconciler cannot import other logic modules (crud/engine/auth/mcp/
// sandbox) — see ARCHITECTURE.md. Cross-module communication goes
// through CrudClient (data) and EngineClient (session dispatch),
// imported as type-only and threaded into the PolicyCtx by the
// composition root.

import type { Db } from '@foundry/db'
import type { Agent, Project, Ticket } from '@foundry/db'
import type { Ctx } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'
import type { EngineClient } from '@foundry/engine/client'

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
  crud:    CrudClient
  engine:  EngineClient
  project: Project
  agents:  Agent[]
  ticket:  Ticket
  slots:   { remaining: number }   // mutable across policies/tickets within a project tick
}

export type Policy = (ctx: PolicyCtx) => Promise<'acted' | 'pass'>
