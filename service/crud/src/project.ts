import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Result } from '@foundry/model'
import { ok, err, pick, now, timestamps } from '@foundry/model'
import type { CrudError } from './schema.js'
import type { project as validate } from './validate.js'
import * as database from './repo.js'

// Ownership-aware fetch: not_found (not permission_denied) on mismatch
// so other accounts can't probe for valid project ids.
export function projectGetOwned(db: Db, id: string, accountId: string): Result<schema.Project, CrudError> {
  const row = database.projectGet(db, id)
  if (!row || row.owner_id !== accountId) return err({ kind: 'not_found', entity: 'project', id })
  return ok(row)
}

// Cross-resource ownership: not_found if missing or owned by a different
// account. Use as a guard whenever a child resource (ticket, session,
// execution, agent) is read or mutated.
export function assertProjectOwner(db: Db, projectId: string, accountId: string): Result<void, CrudError> {
  const row = database.projectGet(db, projectId)
  if (!row || row.owner_id !== accountId) return err({ kind: 'not_found', entity: 'project', id: projectId })
  return ok(undefined)
}

// Resolves a ticket and asserts the requester owns its project. Returns
// the ticket so callers don't double-fetch.
export function ticketOwned(db: Db, ticketId: string, accountId: string): Result<schema.Ticket, CrudError> {
  const t = database.ticketGet(db, ticketId)
  if (!t) return err({ kind: 'not_found', entity: 'ticket', id: ticketId })
  const owner = assertProjectOwner(db, t.project_id, accountId)
  if (!owner.ok) return err({ kind: 'not_found', entity: 'ticket', id: ticketId })
  return ok(t)
}

// Same for sessions: walks session → ticket → project.
export function sessionOwned(db: Db, sessionId: string, accountId: string): Result<schema.Session, CrudError> {
  const s = database.sessionGet(db, sessionId)
  if (!s) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const t = database.ticketGet(db, s.ticket_id)
  if (!t) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  const owner = assertProjectOwner(db, t.project_id, accountId)
  if (!owner.ok) return err({ kind: 'not_found', entity: 'session', id: sessionId })
  return ok(s)
}

// Same for executions: walks execution → session → ticket → project.
// Executions without a session_id (rare) are treated as account-scoped
// and rejected for any non-owner.
export function executionOwned(db: Db, executionId: string, accountId: string): Result<schema.Execution, CrudError> {
  const e = database.executionGet(db, executionId)
  if (!e) return err({ kind: 'not_found', entity: 'execution', id: executionId })
  if (!e.session_id) return ok(e)
  return executionOwnerCheck(db, e, accountId, executionId)
}

function executionOwnerCheck(db: Db, e: schema.Execution, accountId: string, executionId: string): Result<schema.Execution, CrudError> {
  const s = database.sessionGet(db, e.session_id!)
  if (!s) return err({ kind: 'not_found', entity: 'execution', id: executionId })
  const t = database.ticketGet(db, s.ticket_id)
  if (!t) return err({ kind: 'not_found', entity: 'execution', id: executionId })
  const owner = assertProjectOwner(db, t.project_id, accountId)
  if (!owner.ok) return err({ kind: 'not_found', entity: 'execution', id: executionId })
  return ok(e)
}

export function projectList(db: Db, accountId: string, filters: z.infer<typeof validate.list>): Result<schema.Project[], CrudError> {
  const conditions = [eq(schema.project.owner_id, accountId)]
  if (filters.status) conditions.push(eq(schema.project.status, filters.status))
  return ok(database.projectAll(db, conditions))
}

export function projectGet(db: Db, accountId: string, id: string): Result<schema.Project, CrudError> {
  return projectGetOwned(db, id, accountId)
}

export function projectCreate(db: Db, accountId: string, input: z.infer<typeof validate.create>): Result<schema.Project, CrudError> {
  const { name, description = '', repo, max_agents = 3 } = input
  const row = database.projectInsert(db, {
    owner_id: accountId, repo, name, description,
    status: 'active', max_agents, ...timestamps(),
  })
  return ok(row)
}

export function projectUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.update>): Result<schema.Project, CrudError> {
  const prev = projectGetOwned(db, id, accountId)
  if (!prev.ok) return prev
  const updates: Record<string, unknown> = {
    ...pick(input, 'name', 'description', 'repo', 'status', 'max_agents'),
    updated_at: now(),
  }
  if (Object.keys(updates).length <= 1) return ok(prev.value)
  return ok(database.projectUpdate(db, id, updates))
}

// projectRun previously triggered a reconcilerTick from inside the
// service. Cross-module call; the route handler does it after this returns.
export function projectRun(db: Db, accountId: string, id: string): Result<{ ok: true }, CrudError> {
  const proj = projectGetOwned(db, id, accountId)
  if (!proj.ok) return proj
  if (proj.value.status !== 'active') return err({ kind: 'conflict', reason: 'project is not active' })
  return ok({ ok: true })
}

export function projectTagList(db: Db, accountId: string, projectId: string): Result<string[], CrudError> {
  const owned = projectGetOwned(db, projectId, accountId)
  if (!owned.ok) return owned
  return ok(database.projectTagList(db, projectId))
}
