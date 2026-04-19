import type { z } from 'zod'

import { type Db } from '../core/db.js'
import * as database from '../core/db.js'
import * as schema from '../core/schema.js'
import type { Ticket, Comment } from '../core/schema.js'
import type { VerdictRow } from '../core/db.js'
import { mustExist, pick, now, timestamps } from '../core/util.js'
import { conflict, notFound } from '../core/errors.js'
import * as validate from './schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import { assertProjectOwner, ticketOwned } from '../projects/service.js'

export interface DependencyChainEntry {
  id: string; title: string; description: string
  agent_id: string | null; status: string
}

// All ticket queries are scoped to projects the requester owns. The
// underlying database.ticketAll path filters by raw conditions, so we
// pre-resolve the requester's owned project ids and add an inArray
// constraint.
function ownedProjectIds(db: Db, accountId: string): string[] {
  return database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
}

export function ticketList(db: Db, accountId: string, filters: z.infer<typeof validate.ticketList>): Ticket[] {
  const owned = ownedProjectIds(db, accountId)
  if (owned.length === 0) return []
  // If the caller scoped by projectId, verify they own it; otherwise
  // restrict to owned projects.
  if (filters.projectId && !owned.includes(filters.projectId)) return []
  const projectScope = filters.projectId
    ? eq(schema.ticket.project_id, filters.projectId)
    : inArray(schema.ticket.project_id, owned)
  const conditions = [
    projectScope,
    filters.agentId ? eq(schema.ticket.agent_id, filters.agentId) : null,
    filters.status  ? eq(schema.ticket.status,   filters.status)  : null,
  ].filter(Boolean) as any[]
  if (filters.tag) return database.ticketsByTag(db, filters.tag, conditions)
  return database.ticketAll(db, conditions)
}

export function ticketGet(db: Db, accountId: string, id: string): Ticket {
  return ticketOwned(db, id, accountId)
}

export function ticketCreate(db: Db, accountId: string, input: z.infer<typeof validate.ticketCreate>): Ticket {
  const { project_id, agent_id, title, description, priority, depends_on, created_by } = input
  // Caller must own the target project.
  assertProjectOwner(db, project_id, accountId)
  if (depends_on) {
    const dep = mustExist(database.ticketGet(db, depends_on), 'depends_on ticket not found')
    // Cross-project dependency should still respect ownership.
    assertProjectOwner(db, dep.project_id, accountId)
  }
  const row = database.ticketInsert(db, {
    project_id,
    agent_id:   agent_id ?? null,
    title, description, priority,
    status:     'created',
    depends_on: depends_on ?? null,
    created_by, ...timestamps(),
  })
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: row.id,
    kind: 'created', caused_by: created_by,
  })
  return row
}

export function ticketUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.ticketUpdate>): Ticket {
  const t = ticketOwned(db, id, accountId)
  if (t.status !== 'created') throw conflict('ticket can only be edited while in created state')
  if (input.title !== undefined || input.description !== undefined) {
    const sessions = database.sessionByTicket(db, id)
    if (sessions.length > 0) throw conflict('title and description are frozen once work has started — fork this ticket for scope changes')
  }
  return database.ticketUpdate(db, id, { ...pick(input, 'title', 'description', 'agent_id', 'priority'), updated_at: now() })
}

export function ticketCancel(db: Db, accountId: string, id: string): Ticket {
  const t = ticketOwned(db, id, accountId)
  if (t.status === 'finished' || t.status === 'cancelled') {
    throw conflict('ticket is already terminal')
  }
  database.ticketUpdate(db, id, { status: 'cancelled', updated_at: now() })
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: id,
    kind: 'status_changed',
    data: JSON.stringify({ from: t.status, to: 'cancelled' }),
    caused_by: 'founder',
  })
  return mustExist(database.ticketGet(db, id))
}

export function ticketDependencyChain(db: Db, accountId: string, id: string): DependencyChainEntry[] {
  // Anchor must be owned; we then walk the chain. A dep chain may legally
  // cross projects, but every step is checked against the same owner.
  ticketOwned(db, id, accountId)
  const chain: Ticket[] = []
  let current: Ticket | undefined = mustExist(database.ticketGet(db, id))
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.depends_on) break
    const next = database.ticketGet(db, current.depends_on)
    if (!next) break
    // Depending on a ticket in another owner's project would leak titles.
    // 404 the offending step rather than throw — chain just truncates.
    const depProject = database.projectGet(db, next.project_id)
    if (!depProject || depProject.owner_id !== accountId) break
    current = next
  }
  return chain.map(t => ({
    id: t.id, title: t.title, description: t.description,
    agent_id: t.agent_id, status: t.status,
  }))
}

export function ticketPriorHistory(db: Db, ticketId: string, sessionId: string, agentName: string): string {
  const NOISE = new Set(['Session started', 'Session started (SDK)', 'Session finished', 'Session failed', 'Session cancelled', 'Session crashed'])
  const comments = database.commentByTicket(db, ticketId)
    .filter(c => c.session_id !== sessionId && !NOISE.has(c.body))
  if (comments.length === 0) return ''
  const own      = comments.filter(c => c.author === agentName)
  const feedback = comments.filter(c => c.author !== agentName)
  const sections: string[] = []
  if (own.length > 0) {
    sections.push('## Your prior responses on this ticket\n\n' + own.map(c => c.body).join('\n\n---\n\n'))
  }
  if (feedback.length > 0) {
    sections.push(
      '## Feedback from the Founder\n\n' +
      feedback.map(c => `[${c.author}]: ${c.body}`).join('\n\n') +
      '\n\nThe feedback above takes precedence over the original ticket body when they conflict. Address the most recent feedback in this run.',
    )
  }
  return sections.join('\n\n---\n\n')
}

// ── Comments ──

export function commentList(db: Db, accountId: string, ticketId: string): Comment[] {
  ticketOwned(db, ticketId, accountId)
  return database.commentByTicket(db, ticketId)
}

export function commentCreate(db: Db, accountId: string, ticketId: string, input: { author: string; body: string; session_id?: string }): Comment {
  ticketOwned(db, ticketId, accountId)
  return database.commentInsert(db, { ticket_id: ticketId, session_id: input.session_id ?? null, author: input.author, body: input.body, created_at: now() })
}

// ── Verdicts ──

export function verdictList(db: Db, accountId: string, ticketId: string): VerdictRow[] {
  ticketOwned(db, ticketId, accountId)
  return database.verdictByTicket(db, ticketId)
}

// ── Tags (live as a JSON array on ticket.tags now) ──

export function tagList(db: Db, accountId: string, ticketId: string): string[] {
  const t = ticketOwned(db, ticketId, accountId)
  return database.parseTags(t)
}

export function tagAdd(db: Db, accountId: string, ticketId: string, tag: string): string[] {
  const t = ticketOwned(db, ticketId, accountId)
  const next = [...database.parseTags(t), tag]
  database.setTags(db, ticketId, next)
  return database.parseTags(mustExist(database.ticketGet(db, ticketId)))
}

export function tagRemove(db: Db, accountId: string, ticketId: string, tag: string): void {
  const t = ticketOwned(db, ticketId, accountId)
  const lower = tag.toLowerCase().trim()
  const next = database.parseTags(t).filter(x => x !== lower)
  database.setTags(db, ticketId, next)
}
