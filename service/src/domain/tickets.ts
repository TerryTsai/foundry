import { eq, and, ne } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../tables.js'
import type { Ticket, Tag, Comment, Verdict } from '../tables.js'
import { mustExist, assertStatus, pick, now, timestamps } from '../util.js'
import { conflict } from '../errors.js'
import * as validate from '../validate.js'

export type Outcome = 'finished' | 'failed' | 'cancelled'

export interface DependencyChainEntry {
  id: string; title: string; description: string
  agent_id: string | null; status: string; outcome: string | null
}

export function ticketList(db: Db, filters: z.infer<typeof validate.ticketList>): Ticket[] {
  const conditions = [
    filters.projectId ? eq(schema.ticket.project_id, filters.projectId) : null,
    filters.agentId   ? eq(schema.ticket.agent_id,   filters.agentId)   : null,
    filters.status    ? eq(schema.ticket.status,     filters.status)    : null,
    filters.outcome   ? eq(schema.ticket.outcome,    filters.outcome)   : null,
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
  return database.ticketInsert(db, {
    project_id,
    agent_id:    agent_id ?? null,
    title, description, priority,
    status:      'opened',
    outcome:     null,
    depends_on:  depends_on ?? null,
    created_by, ...timestamps(), claimed_at: null,
  })
}

export function ticketUpdate(db: Db, id: string, input: z.infer<typeof validate.ticketUpdate>): Ticket {
  assertStatus(mustExist(database.ticketGet(db, id)), 'opened', 'ticket can only be edited while opened')
  // Title and description are frozen once work has started. Scope change
  // = fork the ticket; edits would hide planning churn.
  if (input.title !== undefined || input.description !== undefined) {
    const sessions = database.sessionByTicket(db, id)
    if (sessions.length > 0) throw conflict('title and description are frozen once work has started — fork this ticket for scope changes')
  }
  return database.ticketUpdate(db, id, { ...pick(input, 'title', 'description', 'agent_id', 'priority'), updated_at: now() })
}

// Atomic claim. Returns the claimed row on success, null if another
// dispatcher won the race.
export function ticketClaim(db: Db, id: string): Ticket | null {
  const claimed = database.ticketClaimIfOpen(db, id, now())
  if (!claimed) return null
  return mustExist(database.ticketGet(db, id))
}

// Resolve a claimed ticket with one of three outcomes.
//   finished  — work succeeded; verifier dance (if any) decides terminal vs reopen
//   failed    — work hit a wall the producer can't get past
//   cancelled — work deliberately abandoned (founder action, not agent self-call)
//
// The runner is responsible for orchestrating the verifier dance after a
// resolve(finished) when the producer's agent has verifiers. This function
// just commits the state transition + comment.
export function ticketResolve(
  db: Db, id: string, outcome: Outcome,
  opts?: { notes?: string; agentName?: string; sessionId?: string },
): Ticket {
  assertStatus(mustExist(database.ticketGet(db, id)), 'claimed')
  const author = opts?.agentName ?? 'system'
  const label  = outcome === 'finished' ? 'Session finished' : outcome === 'failed' ? 'Session failed' : 'Session cancelled'
  const body   = opts?.notes ? `${label}\n${opts.notes}` : label
  const row = database.ticketUpdate(db, id, { status: 'resolved', outcome, updated_at: now() })
  database.commentInsert(db, { ticket_id: id, session_id: opts?.sessionId ?? null, author, body, created_at: now() })
  return row
}

export function ticketReopen(db: Db, id: string): Ticket {
  const t = mustExist(database.ticketGet(db, id))
  if (t.status !== 'resolved') throw conflict('only resolved tickets can be reopened')
  // Verified work is accepted into the project. Changing or removing it
  // is new scope — fork a new ticket instead of reopening.
  const verdicts = database.verdictByTicket(db, id)
  if (verdicts.some(v => v.pass)) throw conflict('verified tickets cannot be reopened — fork a new ticket for scope changes')
  return database.ticketUpdate(db, id, { status: 'opened', outcome: null, claimed_at: null, updated_at: now() })
}

// Walk the dependency chain (was: parent chain). Follows depends_on backwards.
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
    agent_id: t.agent_id, status: t.status, outcome: t.outcome,
  }))
}

// Returns a formatted block of everything said on this ticket outside the
// current session. Feedback section is marked authoritative since human
// follow-ups frequently override the original ticket body.
export function ticketPriorHistory(db: Db, ticketId: string, sessionId: string, agentName: string): string {
  const NOISE = new Set(['Session started', 'Session started (SDK)', 'Session finished', 'Session failed', 'Session cancelled'])
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

// Suppress unused-import complaints during the migration; `and` and `ne`
// are used by callers (scheduler) via re-export of drizzle ops elsewhere.
void and; void ne
