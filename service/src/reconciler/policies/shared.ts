import { type Db } from '../../core/db.js'
import * as database from '../../core/db.js'
import type { Agent, Project, Ticket } from '../../core/schema.js'
import { now } from '../../core/util.js'

import { runSession, type EngineDeps } from '@foundry/engine'
import { sessionJwt } from '@foundry/auth'
import {
  asText, isMcpEnvelope, parseConn, toolUseId,
  filterTools, parseToolSelection, byConnectionKind,
  foundryServer, githubServer, sandboxServer, browserServer,
  workspaceEmpty, workspaceDestroy,
} from '@foundry/mcp'
import {
  executionCreate as sandboxExecutionCreate,
  registerSessionWorkspace, unregisterSessionWorkspace,
  stopSessionContainer,
} from '@foundry/sandbox'
import {
  encryptSecret, decryptSecret, attachmentListByTicketInternal,
} from '@foundry/crud'

// ── shape ────────────────────────────────────────────────────────────
// Each policy receives the same context: the project being reconciled,
// its agents, the ticket under consideration, and a mutable slots
// counter (decremented by dispatching policies as they consume a slot).
//
// 'acted'  → policy made a state change for this ticket; reconciler
//            stops walking the policy list for this tick.
// 'pass'   → policy was not applicable; reconciler tries the next.

export interface PolicyCtx {
  db:      Db
  project: Project
  agents:  Agent[]
  ticket:  Ticket
  slots:   { remaining: number }   // mutable across policies/tickets within a project tick
}

export type Policy = (ctx: PolicyCtx) => 'acted' | 'pass'

// ── shared effects ───────────────────────────────────────────────────

// Transition a ticket from `from` → `to`. Records a status_changed event
// on success (returns true). Returns false if the current status doesn't
// match `from` (race with another tick or operator action).
export function transition(
  db: Db, ticketId: string, from: string, to: string,
  causedBy: string, data?: Record<string, unknown>,
): boolean {
  if (!database.ticketTransition(db, ticketId, from, to)) return false
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: ticketId,
    kind: 'status_changed',
    data: JSON.stringify({ from, to, ...data }),
    caused_by: causedBy,
  })
  return true
}

// EngineDeps bundle. Constructed once at module load — every dispatched
// session gets the same callback wiring. The reconciler is itself a
// logic module per the manifest check; this direct cross-import is the
// temporary debt called out in Phase 4g — reconciler moves out of
// service/ in Phase 4h, at which point this becomes the composition
// root's job in server.ts.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed below
const ENGINE_DEPS: EngineDeps = {
  auth: {
    sessionJwtMint: (db, sessionId, ttlMs) => sessionJwt.mint(db, sessionId, ttlMs),
  },
  mcp: {
    foundryServer, githubServer, sandboxServer, browserServer,
    byConnectionKind: byConnectionKind as Record<string, { tools: import('@foundry/mcp').ToolDef[] } | undefined>,
    filterTools, parseToolSelection,
    parseConn, asText, isMcpEnvelope, toolUseId,
    workspaceEmpty, workspaceDestroy,
  },
  sandbox: {
    executionCreate: (db, config, input) => sandboxExecutionCreate(db, config, input),
    registerSessionWorkspace, unregisterSessionWorkspace,
    stopSessionContainer,
  },
  crud: {
    encryptSecret, decryptSecret, attachmentListByTicketInternal,
  },
}

// Insert a session row, fire the started event, and dispatch the runner
// in the background (fire-and-forget — the runner emits its own events
// when it terminates).
export function dispatchSession(
  db: Db, ticket: Ticket, agent: Agent, role: 'producer' | 'verifier',
): void {
  const sess = database.sessionInsert(db, {
    ticket_id: ticket.id, agent_id: agent.id,
    status: 'running', started_at: now(),
  })
  database.eventInsert(db, {
    entity_type: 'session', entity_id: sess.id,
    kind: 'started',
    data: JSON.stringify({ role, ticket_id: ticket.id, agent_name: agent.name }),
    caused_by: 'reconciler',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- composition-root global set in server.ts
  const config = (globalThis as any).__foundryConfig
  runSession(db, config, ENGINE_DEPS, sess.id, agent, ticket, role)
    .catch((err: unknown) => console.error(`session ${sess.id} crashed:`, err))
}

// Parse the JSON-encoded verifier id list off an agent row.
export function parseVerifierIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
