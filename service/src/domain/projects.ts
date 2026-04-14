import { eq } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import { mustExist, assertStatus, pick, now, timestamps } from '../util.js'
import { notFound } from '../errors.js'
import * as validate from '../validate.js'
import { schedulerDispatch } from './scheduler.js'

// Ownership-aware fetch: 404 (not 403) on mismatch so other accounts can't
// probe for valid project ids.
export function projectGetOwned(db: Db, id: string, accountId: string): schema.Project {
  const row = database.projectGet(db, id)
  if (!row || row.owner_id !== accountId) throw notFound()
  return row
}

export function projectList(db: Db, accountId: string, filters: z.infer<typeof validate.projectList>): schema.Project[] {
  const conditions = [eq(schema.project.owner_id, accountId)]
  if (filters.status) conditions.push(eq(schema.project.status, filters.status))
  return database.projectAll(db, conditions)
}

export function projectGet(db: Db, accountId: string, id: string): schema.Project {
  return projectGetOwned(db, id, accountId)
}

export function projectCreate(db: Db, accountId: string, input: z.infer<typeof validate.projectCreate>): schema.Project {
  const { name, description = '', repo, max_agents = 3 } = input
  return database.projectInsert(db, {
    owner_id: accountId,
    repo, name, description, status: 'active',
    max_agents, ...timestamps(),
  })
}

export function projectUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.projectUpdate>): schema.Project {
  const prev = projectGetOwned(db, id, accountId)
  const updates: Record<string, unknown> = {
    ...pick(input, 'name', 'description', 'repo', 'status', 'max_agents'),
    updated_at: now(),
  }
  if (Object.keys(updates).length <= 1) return prev
  return database.projectUpdate(db, id, updates)
}

export function projectRun(db: Db, accountId: string, id: string): { ok: true } {
  const row = assertStatus(projectGetOwned(db, id, accountId), 'active', 'project is not active')
  schedulerDispatch(db, row.id).catch((err: unknown) =>
    console.error(`dispatch error for project ${row.id}:`, err))
  return { ok: true }
}

export function projectTagList(db: Db, accountId: string, projectId: string): string[] {
  projectGetOwned(db, projectId, accountId)
  return database.projectTagList(db, projectId)
}
