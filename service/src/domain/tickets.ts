import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Ticket, Tag, Comment, Verdict } from '../tables.js'
import { mustExist, pick, now, timestamps } from '../util.js'
import { conflict } from '../errors.js'
import * as validate from '../validate.js'
import { eq } from 'drizzle-orm'

export interface DependencyChainEntry {
  id: string; title: string; description: string
  agent_id: string | null; status: string
}

export function ticketList(db: Db, filters: z.infer<typeof validate.ticketList>): Ticket[] {
  const conditions = [
    filters.projectId ? eq(schema.ticket.project_id, filters.projectId) : null,
    filters.agentId   ? eq(schema.ticket.agent_id,   filters.agentId)   : null,
    filters.status    ? eq(schema.ticket.status,     filters.status)    : null,
  ].filter(Boolean) as any[]
  if (filters.tag) return database.ticketsByTag(db, filters.tag, conditions)
  return database.ticketAll(db, conditions)
}

export function ticketGet(db: Db, id: string): Ticket {
  return mustExist(database.ticketGet(db, id))
}

export function ticketCreate(db: Db, input: z.infer<typeof validate.ticketCreate>): Ticket {
  const { project_id, agent_id, title, description, priority, depends_on, created_by } = input
  if (depends_on) mustExist(database.ticketGet(db, depends_on), 'depends_on ticket not found')
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

export function ticketUpdate(db: Db, id: string, input: z.infer<typeof validate.ticketUpdate>): Ticket {
  const t = mustExist(database.ticketGet(db, id))
  if (t.status !== 'created') throw conflict('ticket can only be edited while in created state')
  if (input.title !== undefined || input.description !== undefined) {
    const sessions = database.sessionByTicket(db, id)
    if (sessions.length > 0) throw conflict('title and description are frozen once work has started — fork this ticket for scope changes')
  }
  return database.ticketUpdate(db, id, { ...pick(input, 'title', 'description', 'agent_id', 'priority'), updated_at: now() })
}

export function ticketCancel(db: Db, id: string): Ticket {
  const t = mustExist(database.ticketGet(db, id))
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

export function ticketDependencyChain(db: Db, id: string): DependencyChainEntry[] {
  const chain: Ticket[] = []
  let current: Ticket | undefined = mustExist(database.ticketGet(db, id))
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.depends_on) break
    current = database.ticketGet(db, current.depends_on)
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

export function commentList(db: Db, ticketId: string): Comment[] {
  mustExist(database.ticketGet(db, ticketId))
  return database.commentByTicket(db, ticketId)
}

export function commentCreate(db: Db, ticketId: string, input: { author: string; body: string; session_id?: string }): Comment {
  mustExist(database.ticketGet(db, ticketId))
  return database.commentInsert(db, { ticket_id: ticketId, session_id: input.session_id ?? null, author: input.author, body: input.body, created_at: now() })
}

// ── Verdicts ──

export function verdictList(db: Db, ticketId: string): Verdict[] {
  mustExist(database.ticketGet(db, ticketId))
  return database.verdictByTicket(db, ticketId)
}

// ── Tags ──

export function tagList(db: Db, ticketId: string): Tag[] {
  return database.ticketTagList(db, ticketId)
}

export function tagAdd(db: Db, ticketId: string, tag: string): Tag {
  mustExist(database.ticketGet(db, ticketId))
  try {
    return database.ticketTagInsert(db, ticketId, tag)
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.message?.includes('UNIQUE constraint failed')) {
      const existing = database.ticketTagList(db, ticketId).find(t => t.tag === tag.toLowerCase().trim())
      return existing!
    }
    throw err
  }
}

export function tagRemove(db: Db, ticketId: string, tag: string): void {
  database.ticketTagRemove(db, ticketId, tag)
}
