import type { z } from 'zod'
import { eq, inArray, type SQL } from 'drizzle-orm'

import { type Db } from '@foundry/db'
import * as schema from '@foundry/db'
import type { Ticket, Comment } from '@foundry/db'
import type { Result, CrudError } from '@foundry/model'
import { ok, err, pick, now, timestamps } from '@foundry/model'
import type { ticket as validate } from './validators.js'
import { assertProjectOwner, ticketOwned } from './project.js'
import * as database from './repo.js'
import type { VerdictRow } from './repo.js'

export interface DependencyChainEntry {
  id: string; title: string; description: string
  agent_id: string | null; status: string
}

// All ticket queries scope to projects the requester owns. Pre-resolve
// owned project ids and add an inArray constraint.
function ownedProjectIds(db: Db, accountId: string): string[] {
  return database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
}

export function ticketList(db: Db, accountId: string, filters: z.infer<typeof validate.list>): Result<Ticket[], CrudError> {
  const owned = ownedProjectIds(db, accountId)
  if (owned.length === 0) return ok([])
  if (filters.projectId && !owned.includes(filters.projectId)) return ok([])
  return ok(ticketListByFilters(db, owned, filters))
}

function ticketListByFilters(db: Db, owned: string[], filters: z.infer<typeof validate.list>): Ticket[] {
  const projectScope = filters.projectId
    ? eq(schema.ticket.project_id, filters.projectId)
    : inArray(schema.ticket.project_id, owned)
  const conditions = [
    projectScope,
    filters.agentId ? eq(schema.ticket.agent_id, filters.agentId) : null,
    filters.status  ? eq(schema.ticket.status,   filters.status)  : null,
  ].filter((c): c is SQL => c !== null)
  if (filters.tag) return database.ticketsByTag(db, filters.tag, conditions)
  return database.ticketAll(db, conditions)
}

export function ticketGet(db: Db, accountId: string, id: string): Result<Ticket, CrudError> {
  return ticketOwned(db, id, accountId)
}

export function ticketCreate(db: Db, accountId: string, input: z.infer<typeof validate.create>): Result<Ticket, CrudError> {
  const { project_id, depends_on } = input
  const owner = assertProjectOwner(db, project_id, accountId)
  if (!owner.ok) return owner
  if (depends_on) {
    const depCheck = ticketCreateDepCheck(db, depends_on, accountId)
    if (!depCheck.ok) return depCheck
  }
  return ok(ticketCreateInsert(db, input))
}

function ticketCreateDepCheck(db: Db, depId: string, accountId: string): Result<void, CrudError> {
  const dep = database.ticketGet(db, depId)
  if (!dep) return err({ kind: 'not_found', entity: 'ticket', id: depId })
  return assertProjectOwner(db, dep.project_id, accountId)
}

function ticketCreateInsert(db: Db, input: z.infer<typeof validate.create>): Ticket {
  const { project_id, agent_id, title, description, depends_on, created_by } = input
  const row = database.ticketInsert(db, {
    project_id, agent_id: agent_id ?? null, title, description,
    status: 'created', depends_on: depends_on ?? null,
    created_by, ...timestamps(),
  })
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: row.id,
    kind: 'created', caused_by: created_by,
  })
  return row
}

export function ticketUpdate(db: Db, accountId: string, id: string, input: z.infer<typeof validate.update>): Result<Ticket, CrudError> {
  const t = ticketOwned(db, id, accountId)
  if (!t.ok) return t
  if (t.value.status !== 'created') return err({ kind: 'conflict', reason: 'ticket can only be edited while in created state' })
  if (input.title !== undefined || input.description !== undefined) {
    const sessions = database.sessionByTicket(db, id)
    if (sessions.length > 0) return err({ kind: 'conflict', reason: 'title and description are frozen once work has started — fork this ticket for scope changes' })
  }
  return ok(database.ticketUpdate(db, id, { ...pick(input, 'title', 'description', 'agent_id'), updated_at: now() }))
}

// ticketCancel previously called killRunningExecutionsForTicket. That's a
// cross-module call now in the route handler.
export function ticketCancel(db: Db, accountId: string, id: string): Result<Ticket, CrudError> {
  const t = ticketOwned(db, id, accountId)
  if (!t.ok) return t
  if (t.value.status === 'finished' || t.value.status === 'cancelled') {
    return err({ kind: 'conflict', reason: 'ticket is already terminal' })
  }
  ticketCancelWrite(db, id, t.value.status)
  const refreshed = database.ticketGet(db, id)
  if (!refreshed) return err({ kind: 'not_found', entity: 'ticket', id })
  return ok(refreshed)
}

function ticketCancelWrite(db: Db, id: string, fromStatus: string): void {
  database.ticketUpdate(db, id, { status: 'cancelled', updated_at: now() })
  database.eventInsert(db, {
    entity_type: 'ticket', entity_id: id,
    kind: 'status_changed',
    data: JSON.stringify({ from: fromStatus, to: 'cancelled' }),
    caused_by: 'founder',
  })
}

export function ticketDependencyChain(db: Db, accountId: string, id: string): Result<DependencyChainEntry[], CrudError> {
  const anchor = ticketOwned(db, id, accountId)
  if (!anchor.ok) return anchor
  return ok(walkDependencyChain(db, anchor.value, accountId))
}

function walkDependencyChain(db: Db, anchor: Ticket, accountId: string): DependencyChainEntry[] {
  const chain: Ticket[] = []
  const visited = new Set<string>()
  let current: Ticket | undefined = anchor
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift(current)
    current = nextDependencyStep(db, current, accountId)
  }
  return chain.map(t => ({
    id: t.id, title: t.title, description: t.description,
    agent_id: t.agent_id, status: t.status,
  }))
}

function nextDependencyStep(db: Db, current: Ticket, accountId: string): Ticket | undefined {
  if (!current.depends_on) return undefined
  const next = database.ticketGet(db, current.depends_on)
  if (!next) return undefined
  // Depending on another owner's ticket would leak titles; truncate.
  const depProject = database.projectGet(db, next.project_id)
  if (!depProject || depProject.owner_id !== accountId) return undefined
  return next
}

const NOISE_COMMENTS = new Set([
  'Session started', 'Session started (SDK)', 'Session finished',
  'Session failed', 'Session cancelled', 'Session crashed',
])

export function ticketPriorHistory(db: Db, ticketId: string, sessionId: string, agentName: string): string {
  const comments = database.commentByTicket(db, ticketId)
    .filter(c => c.session_id !== sessionId && !NOISE_COMMENTS.has(c.body))
  if (comments.length === 0) return ''
  return formatPriorHistory(comments, agentName)
}

function formatPriorHistory(comments: Comment[], agentName: string): string {
  const own      = comments.filter(c => c.author === agentName)
  const feedback = comments.filter(c => c.author !== agentName)
  const sections: string[] = []
  if (own.length > 0) sections.push(formatOwnSection(own))
  if (feedback.length > 0) sections.push(formatFeedbackSection(feedback))
  return sections.join('\n\n---\n\n')
}

function formatOwnSection(own: Comment[]): string {
  return '## Your prior responses on this ticket\n\n' + own.map(c => c.body).join('\n\n---\n\n')
}

function formatFeedbackSection(feedback: Comment[]): string {
  return '## Feedback from the Founder\n\n' +
    feedback.map(c => `[${c.author}]: ${c.body}`).join('\n\n') +
    '\n\nThe feedback above takes precedence over the original ticket body when they conflict. Address the most recent feedback in this run.'
}

// ── Comments ──

export function commentList(db: Db, accountId: string, ticketId: string): Result<Comment[], CrudError> {
  const owned = ticketOwned(db, ticketId, accountId)
  if (!owned.ok) return owned
  return ok(database.commentByTicket(db, ticketId))
}

export function commentCreate(db: Db, accountId: string, ticketId: string, input: { author: string; body: string; session_id?: string }): Result<Comment, CrudError> {
  const owned = ticketOwned(db, ticketId, accountId)
  if (!owned.ok) return owned
  return ok(database.commentInsert(db, {
    ticket_id: ticketId, session_id: input.session_id ?? null,
    author: input.author, body: input.body, created_at: now(),
  }))
}

// ── Verdicts ──

export function verdictList(db: Db, accountId: string, ticketId: string): Result<VerdictRow[], CrudError> {
  const owned = ticketOwned(db, ticketId, accountId)
  if (!owned.ok) return owned
  return ok(database.verdictByTicket(db, ticketId))
}

// ── Tags ──

export function tagList(db: Db, accountId: string, ticketId: string): Result<string[], CrudError> {
  const t = ticketOwned(db, ticketId, accountId)
  if (!t.ok) return t
  return ok(database.parseTags(t.value))
}

export function tagAdd(db: Db, accountId: string, ticketId: string, tag: string): Result<string[], CrudError> {
  const t = ticketOwned(db, ticketId, accountId)
  if (!t.ok) return t
  const next = [...database.parseTags(t.value), tag]
  database.setTags(db, ticketId, next)
  const refreshed = database.ticketGet(db, ticketId)
  if (!refreshed) return err({ kind: 'not_found', entity: 'ticket', id: ticketId })
  return ok(database.parseTags(refreshed))
}

export function tagRemove(db: Db, accountId: string, ticketId: string, tag: string): Result<void, CrudError> {
  const t = ticketOwned(db, ticketId, accountId)
  if (!t.ok) return t
  const lower = tag.toLowerCase().trim()
  const next = database.parseTags(t.value).filter(x => x !== lower)
  database.setTags(db, ticketId, next)
  return ok(undefined)
}
