import { eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Ticket, Tag, Comment } from '../tables.js'
import { mustExist, assertStatus, pick, now, timestamps } from '../util.js'
import * as validate from '../validate.js'

export interface TicketChainEntry {
  id: string; title: string; description: string
  agent_id: string | null; status: string
}

export function ticketList(db: Db, filters: z.infer<typeof validate.ticketList>): Ticket[] {
  const conditions = [
    filters.projectId ? eq(schema.ticket.project_id, filters.projectId) : null,
    filters.agentId   ? eq(schema.ticket.agent_id, filters.agentId)     : null,
    filters.status    ? eq(schema.ticket.status, filters.status)         : null,
    filters.parentId === 'null' ? isNull(schema.ticket.parent_id)
      : filters.parentId        ? eq(schema.ticket.parent_id, filters.parentId) : null,
  ].filter(Boolean) as any[]
  if (filters.tag) return database.ticketsByTag(db, filters.tag, conditions)
  return database.ticketAll(db, conditions)
}

export function ticketGet(db: Db, id: string): Ticket {
  return mustExist(database.ticketGet(db, id))
}

export function ticketCreate(db: Db, input: z.infer<typeof validate.ticketCreate>): Ticket {
  const { project_id, agent_id, title, description, priority, parent_id, blocked_by, created_by, block } = input
  if (parent_id)  mustExist(database.ticketGet(db, parent_id), 'parent_id not found')
  if (blocked_by) mustExist(database.ticketGet(db, blocked_by), 'blocked_by ticket not found')

  return db.transaction(tx => {
    const row = database.ticketInsert(tx as any, {
      project_id, agent_id: agent_id ?? null, title, description, priority,
      status: blocked_by ? 'blocked' : 'open',
      parent_id: parent_id ?? null,
      blocked_by: blocked_by ?? null,
      created_by, ...timestamps(), claimed_at: null,
    })
    if (block && parent_id && database.ticketGet(tx as any, parent_id)?.status === 'claimed') {
      database.ticketUpdate(tx as any, parent_id, { status: 'blocked', updated_at: now() })
    }
    return row
  }) as Ticket
}

export function ticketUpdate(db: Db, id: string, input: z.infer<typeof validate.ticketUpdate>): Ticket {
  assertStatus(mustExist(database.ticketGet(db, id)), 'open', 'ticket can only be edited while open')
  return database.ticketUpdate(db, id, { ...pick(input, 'title', 'body', 'agent_id', 'priority'), updated_at: now() })
}

// Atomic claim. Returns the claimed row on success, null if another
// dispatcher won the race.
export function ticketClaim(db: Db, id: string): Ticket | null {
  const claimed = database.ticketClaimIfOpen(db, id, now())
  if (!claimed) return null
  return mustExist(database.ticketGet(db, id))
}

export function ticketComplete(db: Db, id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket {
  return db.transaction(tx => {
    const d = tx as any
    const row = assertStatus(mustExist(database.ticketGet(d, id)), 'claimed')
    database.ticketUpdate(d, id, { status: 'done', updated_at: now() })
    const author = opts?.agentName ?? 'system'
    const body = opts?.notes ? `Session completed\n${opts.notes}` : 'Session completed'
    database.commentInsert(d, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
    // Unblock parent ticket if it was blocked by a child (legacy pattern).
    if (row.parent_id && database.ticketGet(d, row.parent_id)?.status === 'blocked') {
      database.ticketUpdate(d, row.parent_id, { status: 'open', updated_at: now() })
    }
    // Unblock any tickets that were waiting on this one via blocked_by.
    const dependents = database.ticketAll(d, [eq(schema.ticket.blocked_by, id)])
    for (const dep of dependents) {
      if (dep.status === 'blocked') {
        database.ticketUpdate(d, dep.id, { status: 'open', updated_at: now() })
      }
    }
    return mustExist(database.ticketGet(d, id))
  }) as Ticket
}

export function ticketFail(db: Db, id: string, opts?: { notes?: string; agentName?: string; sessionId?: string }): Ticket {
  assertStatus(mustExist(database.ticketGet(db, id)), 'claimed')
  const row = database.ticketUpdate(db, id, { status: 'failed', updated_at: now() })
  const author = opts?.agentName ?? 'system'
  const body = opts?.notes ? `Session failed\n${opts.notes}` : 'Session failed'
  database.commentInsert(db, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
  return row
}

export function ticketReopen(db: Db, id: string): Ticket {
  assertStatus(mustExist(database.ticketGet(db, id)), ['done', 'failed'], 'only done or failed tickets can be reopened')
  return database.ticketUpdate(db, id, { status: 'reopened', claimed_at: null, updated_at: now() })
}

export function ticketChain(db: Db, id: string): TicketChainEntry[] {
  const chain: Ticket[] = []
  let current: Ticket | undefined = mustExist(database.ticketGet(db, id))
  const visited = new Set<string>()
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.parent_id) break
    current = database.ticketGet(db, current.parent_id)
  }
  return chain.map(t => ({
    id: t.id, title: t.title, description: t.description,
    agent_id: t.agent_id, status: t.status,
  }))
}

// Returns a formatted block of everything said on this ticket outside the
// current session. Feedback section is marked authoritative since human
// follow-ups frequently override the original ticket body.
export function ticketPriorHistory(db: Db, ticketId: string, sessionId: string, agentName: string): string {
  const NOISE = new Set(['Session started', 'Session started (SDK)', 'Session completed'])
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
