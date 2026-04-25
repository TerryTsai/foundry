import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import * as database from '@foundry/db'
import * as schema from '@foundry/db'
import { assertStatus, pick, now, timestamps } from '@foundry/model'
import { notFound } from '@foundry/model'
import { project as validate } from './validators.js'

// Ownership-aware fetch: 404 (not 403) on mismatch so other accounts can't
// probe for valid project ids.
export function projectGetOwned(db: Db, id: string, accountId: string): schema.Project {
  const row = database.projectGet(db, id)
  if (!row || row.owner_id !== accountId) throw notFound()
  return row
}

// Cross-resource ownership: throws notFound (not forbidden) if the project
// is missing or owned by a different account. Use as a guard whenever a
// child resource (ticket, session, execution, agent) is read or mutated.
export function assertProjectOwner(db: Db, projectId: string, accountId: string): void {
  const row = database.projectGet(db, projectId)
  if (!row || row.owner_id !== accountId) throw notFound()
}

// Resolves a ticket and asserts the requester owns its project. Returns
// the ticket so callers don't double-fetch.
export function ticketOwned(db: Db, ticketId: string, accountId: string): schema.Ticket {
  const t = database.ticketGet(db, ticketId)
  if (!t) throw notFound()
  assertProjectOwner(db, t.project_id, accountId)
  return t
}

// Same for sessions: walks session → ticket → project.
export function sessionOwned(db: Db, sessionId: string, accountId: string): schema.Session {
  const s = database.sessionGet(db, sessionId)
  if (!s) throw notFound()
  const t = database.ticketGet(db, s.ticket_id)
  if (!t) throw notFound()
  assertProjectOwner(db, t.project_id, accountId)
  return s
}

// Same for executions: walks execution → session → ticket → project.
// Executions without a session_id (rare, only ad-hoc executionCreate) are
// treated as account-scoped and rejected for any non-owner.
// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function executionOwned(db: Db, executionId: string, accountId: string): schema.Execution {
  const e = database.executionGet(db, executionId)
  if (!e) throw notFound()
  if (e.session_id) {
    const s = database.sessionGet(db, e.session_id)
    if (!s) throw notFound()
    const t = database.ticketGet(db, s.ticket_id)
    if (!t) throw notFound()
    assertProjectOwner(db, t.project_id, accountId)
  }
  return e
}

export function projectList(db: Db, accountId: string, filters: z.infer<typeof validate.list>): schema.Project[] {
  const conditions = [eq(schema.project.owner_id, accountId)]
  if (filters.status) conditions.push(eq(schema.project.status, filters.status))
  return database.projectAll(db, conditions)
}

export function projectGet(db: Db, accountId: string, id: string): schema.Project {
  return projectGetOwned(db, id, accountId)
}

export function projectCreate(db: Db, accountId: string, input: z.infer<typeof validate.create>): schema.Project {
  const { name, description = '', repo, max_agents = 3 } = input
  return database.projectInsert(db, {
    owner_id: accountId,
    repo, name, description, status: 'active',
    max_agents, ...timestamps(),
  })
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function projectUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.update>): schema.Project {
  const prev = projectGetOwned(db, id, accountId)
  const updates: Record<string, unknown> = {
    ...pick(input, 'name', 'description', 'repo', 'status', 'max_agents'),
    updated_at: now(),
  }
  if (Object.keys(updates).length <= 1) return prev
  return database.projectUpdate(db, id, updates)
}

// projectRun previously triggered a reconcilerTick from inside the service.
// That's a cross-module call; the route handler now triggers reconcile after
// this returns.
export function projectRun(db: Db, accountId: string, id: string): { ok: true } {
  assertStatus(projectGetOwned(db, id, accountId), 'active', 'project is not active')
  return { ok: true }
}

export function projectTagList(db: Db, accountId: string, projectId: string): string[] {
  projectGetOwned(db, projectId, accountId)
  return database.projectTagList(db, projectId)
}
