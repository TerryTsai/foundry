import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'

import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../schema.js'
import { require, pick, now, ts } from '../functional.js'
import { notFound } from '../errors.js'
import * as validate from '../validate.js'
import { schedulerDispatch } from './scheduler.js'
import { assertStatus } from '../functional.js'

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
    max_agents, ...ts(),
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

export function projectAnalytics(db: Db, accountId: string, projectId: string, days: number) {
  projectGetOwned(db, projectId, accountId)
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  const summary = db.get<{
    total_cost_usd: number; total_sessions: number
    sessions_done: number; sessions_failed: number; sessions_running: number
    total_tokens_in: number; total_tokens_out: number; total_duration_ms: number
    total_exec_count: number; total_cpu_ms: number; total_net_bytes: number
    peak_memory_mb: number | null
  }>(sql`
    WITH rs AS (
      SELECT s.id, s.status, s.cost_usd, s.duration_ms
      FROM session s JOIN ticket t ON s.ticket_id = t.id
      WHERE t.project_id = ${projectId} AND date(s.started_at) >= ${cutoff}
    )
    SELECT
      COALESCE(SUM(rs.cost_usd), 0) AS total_cost_usd,
      COUNT(*) AS total_sessions,
      COALESCE(SUM(CASE WHEN rs.status = 'done' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN rs.status = 'failed' THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(CASE WHEN rs.status = 'running' THEN 1 ELSE 0 END), 0) AS sessions_running,
      COALESCE(SUM(rs.duration_ms), 0) AS total_duration_ms,
      COALESCE((SELECT SUM(m.tokens_in) FROM message m WHERE m.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_in,
      COALESCE((SELECT SUM(m.tokens) FROM message m WHERE m.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_out,
      COALESCE((SELECT COUNT(*) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_exec_count,
      COALESCE((SELECT SUM(e.cpu_ms) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_cpu_ms,
      COALESCE((SELECT SUM(COALESCE(e.net_rx_bytes,0)+COALESCE(e.net_tx_bytes,0)) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_net_bytes,
      (SELECT MAX(e.peak_memory_mb) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)) AS peak_memory_mb
    FROM rs
  `)!

  const tickets = db.get<{
    total_tickets: number; tickets_open: number; tickets_done: number; tickets_failed: number
  }>(sql`
    SELECT
      COUNT(*) AS total_tickets,
      COALESCE(SUM(CASE WHEN status IN ('open','reopened','claimed','blocked') THEN 1 ELSE 0 END), 0) AS tickets_open,
      COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS tickets_done,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS tickets_failed
    FROM ticket WHERE project_id = ${projectId}
  `)!

  const daily = db.all<{
    date: string; sessions: number; sessions_done: number; sessions_failed: number
    cost_usd: number; tokens_in: number; tokens_out: number
    tickets_created: number; tickets_completed: number
  }>(sql`
    WITH RECURSIVE dates(d) AS (
      SELECT ${cutoff}
      UNION ALL
      SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
    ),
    sd AS (
      SELECT s.id, s.status, s.cost_usd, date(s.started_at) AS day
      FROM session s JOIN ticket t ON s.ticket_id = t.id
      WHERE t.project_id = ${projectId} AND date(s.started_at) >= ${cutoff}
    ),
    sm AS (
      SELECT sd.day, COALESCE(SUM(m.tokens_in),0) AS tokens_in, COALESCE(SUM(m.tokens),0) AS tokens_out
      FROM sd JOIN message m ON m.session_id = sd.id
      GROUP BY sd.day
    )
    SELECT
      dates.d AS date,
      COUNT(sd.id) AS sessions,
      COALESCE(SUM(CASE WHEN sd.status = 'done' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN sd.status = 'failed' THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(sd.cost_usd), 0) AS cost_usd,
      COALESCE(sm.tokens_in, 0) AS tokens_in,
      COALESCE(sm.tokens_out, 0) AS tokens_out,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id = ${projectId} AND date(t.created_at) = dates.d) AS tickets_created,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id = ${projectId} AND t.status = 'done' AND date(t.updated_at) = dates.d) AS tickets_completed
    FROM dates
    LEFT JOIN sd ON sd.day = dates.d
    LEFT JOIN sm ON sm.day = dates.d
    GROUP BY dates.d
    ORDER BY dates.d
  `)

  const agents = db.all<{
    agent_id: string; agent_name: string
    sessions: number; sessions_done: number; sessions_failed: number
    cost_usd: number; tokens_in: number; tokens_out: number
    duration_ms: number; avg_duration_ms: number; avg_cost_usd: number
  }>(sql`
    SELECT
      a.id AS agent_id, a.name AS agent_name,
      COUNT(*) AS sessions,
      COALESCE(SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(s.cost_usd), 0) AS cost_usd,
      COALESCE(SUM(m_agg.tokens_in), 0) AS tokens_in,
      COALESCE(SUM(m_agg.tokens_out), 0) AS tokens_out,
      COALESCE(SUM(s.duration_ms), 0) AS duration_ms,
      COALESCE(AVG(s.duration_ms), 0) AS avg_duration_ms,
      COALESCE(AVG(s.cost_usd), 0) AS avg_cost_usd
    FROM session s
    JOIN ticket t ON s.ticket_id = t.id
    JOIN agent a ON s.agent_id = a.id
    LEFT JOIN (
      SELECT session_id, SUM(tokens_in) AS tokens_in, SUM(tokens) AS tokens_out
      FROM message GROUP BY session_id
    ) m_agg ON m_agg.session_id = s.id
    WHERE t.project_id = ${projectId} AND date(s.started_at) >= ${cutoff}
    GROUP BY a.id
    ORDER BY cost_usd DESC
  `)

  const tags = db.all<{
    tag: string; tickets: number; tickets_done: number; tickets_failed: number
    sessions: number; cost_usd: number; tokens_in: number; tokens_out: number; duration_ms: number
  }>(sql`
    SELECT
      tt.tag,
      COUNT(DISTINCT t.id) AS tickets,
      COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) AS tickets_done,
      COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN t.id END) AS tickets_failed,
      COUNT(DISTINCT s.id) AS sessions,
      COALESCE(SUM(s.cost_usd), 0) AS cost_usd,
      COALESCE(SUM(m_agg.tokens_in), 0) AS tokens_in,
      COALESCE(SUM(m_agg.tokens_out), 0) AS tokens_out,
      COALESCE(SUM(s.duration_ms), 0) AS duration_ms
    FROM ticket_tag tt
    JOIN ticket t ON tt.ticket_id = t.id
    LEFT JOIN session s ON s.ticket_id = t.id AND date(s.started_at) >= ${cutoff}
    LEFT JOIN (
      SELECT session_id, SUM(tokens_in) AS tokens_in, SUM(tokens) AS tokens_out
      FROM message GROUP BY session_id
    ) m_agg ON m_agg.session_id = s.id
    WHERE t.project_id = ${projectId}
    GROUP BY tt.tag
    ORDER BY tickets DESC
  `)

  return { summary: { ...summary, ...tickets }, daily, agents, tags }
}

export function projectTagList(db: Db, accountId: string, projectId: string): string[] {
  projectGetOwned(db, projectId, accountId)
  return database.projectTagList(db, projectId)
}
