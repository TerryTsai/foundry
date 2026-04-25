// Execution metering — DB writes for the per-tool-call execution rows.
// Sandbox owns the container/podman lifecycle and the live EventEmitter
// streaming machinery; metering moved here so non-crud modules don't
// touch drizzle directly.
//
// The functions below return whatever the existing code needs (no
// ownership check, since these are called from the sandbox runtime,
// not from authenticated routes). Route-level executionList /
// executionGet still go through ownership-aware helpers in
// project.ts (executionOwned).

import { eq } from 'drizzle-orm'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Execution } from '@foundry/db'
import { now } from '@foundry/model'
import * as database from './repo.js'

// ── reads ────────────────────────────────────────────────────────────

// All executions in projects this account owns, newest first, capped at 200.
// Walks the join in JS — execution volume is bounded.
export function executionList(db: Db, accountId: string): Execution[] {
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

export function executionGet(db: Db, id: string): Execution | undefined {
  return database.executionGet(db, id)
}

export function executionBySession(db: Db, sessionId: string): Execution[] {
  return database.executionBySession(db, sessionId)
}

// ── writes (called by sandbox runtime via injected callbacks) ────────

export interface ExecutionInsertInput {
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

export function executionCreate(db: Db, input: ExecutionInsertInput): Execution {
  return database.executionInsert(db, {
    session_id:  input.session_id  ?? null,
    tool_name:   input.tool_name   ?? null,
    tool_input:  input.tool_input  ?? null,
    tool_use_id: input.tool_use_id ?? null,
    command:     input.command,
    status:      input.status,
    timeout_ms:  input.timeout_ms,
    memory_mb:   input.memory_mb   ?? null,
    started_at:  input.started_at,
  })
}

export function executionUpdate(db: Db, id: string, data: Record<string, unknown>): Execution {
  return database.executionUpdate(db, id, data)
}

// Mark a row cancelled. Sandbox handles the actual kill via its
// in-memory exec map; this only writes the terminal state.
export function executionMarkCancelled(db: Db, id: string): Execution {
  return database.executionUpdate(db, id, { status: 'cancelled', exit_code: -1, ended_at: now() })
}

// Sessions for a ticket, raw rows. Used to enumerate which executions
// to kill on ticket cancel.
export function sessionsForTicketRaw(db: Db, ticketId: string) {
  return database.sessionsByTicketRaw(db, ticketId)
}
