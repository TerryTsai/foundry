import { eq, sql, type SQL } from 'drizzle-orm'
import { type Db } from '@foundry/db'
import * as database from '@foundry/db'
import * as schema from '@foundry/db'
import type { Result, AnalyticsError } from '@foundry/model'
import { ok } from '@foundry/model'

// Usage analytics across every project the account owns, optionally
// narrowed to a single project, agent, or tag.

export interface AnalyticsArgs {
  days: number
  projectId?: string
  agentId?: string
  tag?: string
}

interface AnalyticsScope {
  projList:    SQL
  agentFilter: SQL
  tagFilter:   SQL
  cutoff:      string
}

export interface AnalyticsResult {
  summary: SummaryRow & TicketCountsRow
  daily:   DailyRow[]
  agents:  AgentRow[]
  tags:    TagRow[]
  tools:   ToolRow[]
}

export function analytics(db: Db, accountId: string, opts: AnalyticsArgs): Result<AnalyticsResult, AnalyticsError> {
  const projectIds = scopeProjectIds(db, accountId, opts.projectId)
  if (projectIds.length === 0) return ok(emptyAnalytics())
  const scope = buildScope(opts, projectIds)
  return ok(buildAggregates(db, scope))
}

function scopeProjectIds(db: Db, accountId: string, projectId: string | undefined): string[] {
  const ownedIds = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  if (projectId) return ownedIds.includes(projectId) ? [projectId] : []
  return ownedIds
}

function buildScope(opts: AnalyticsArgs, projectIds: string[]): AnalyticsScope {
  const cutoff = new Date(Date.now() - opts.days * 86400000).toISOString().slice(0, 10)
  return {
    projList:    sql.join(projectIds.map(id => sql`${id}`), sql`, `),
    agentFilter: opts.agentId ? sql`AND s.agent_id = ${opts.agentId}` : sql``,
    tagFilter:   opts.tag ? sql`AND EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ${opts.tag})` : sql``,
    cutoff,
  }
}

function buildAggregates(db: Db, s: AnalyticsScope) {
  return {
    summary: { ...querySummary(db, s), ...queryTicketCounts(db, s) },
    daily:   queryDaily(db, s),
    agents:  queryAgents(db, s),
    tags:    queryTags(db, s),
    tools:   queryTools(db, s),
  }
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate; splitting moves chunks of WITH/SELECT around and hurts readability
function querySummary(db: Db, s: AnalyticsScope): SummaryRow {
  return db.get<SummaryRow>(sql`
    WITH rs AS (
      SELECT s.id, s.status, s.cost_usd, s.duration_ms
      FROM session s JOIN ticket t ON s.ticket_id = t.id
      WHERE t.project_id IN (${s.projList}) AND date(s.started_at) >= ${s.cutoff}
      ${s.agentFilter}
      ${s.tagFilter}
    )
    SELECT
      COALESCE(SUM(rs.cost_usd), 0) AS total_cost_usd,
      COUNT(*) AS total_sessions,
      COALESCE(SUM(CASE WHEN rs.status = 'finished' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN rs.status = 'failed'   THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(CASE WHEN rs.status = 'running'  THEN 1 ELSE 0 END), 0) AS sessions_running,
      COALESCE(SUM(rs.duration_ms), 0) AS total_duration_ms,
      COALESCE((SELECT SUM(a.tokens_in) FROM activity  a WHERE a.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_in,
      COALESCE((SELECT SUM(a.tokens)    FROM activity  a WHERE a.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_out,
      COALESCE((SELECT COUNT(*)         FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_exec_count,
      COALESCE((SELECT SUM(e.cpu_ms)    FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_cpu_ms,
      COALESCE((SELECT SUM(COALESCE(e.net_rx_bytes,0)+COALESCE(e.net_tx_bytes,0)) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_net_bytes,
      (SELECT MAX(e.peak_memory_mb) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)) AS peak_memory_mb
    FROM rs
  `)!
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate
function queryTicketCounts(db: Db, s: AnalyticsScope): TicketCountsRow {
  return db.get<TicketCountsRow>(sql`
    SELECT
      COUNT(*) AS total_tickets,
      COALESCE(SUM(CASE WHEN t.status IN ('created','waiting','running') THEN 1 ELSE 0 END), 0) AS tickets_open,
      COALESCE(SUM(CASE WHEN t.status = 'finished' THEN 1 ELSE 0 END), 0) AS tickets_done,
      COALESCE(SUM(CASE WHEN t.status = 'failed'   THEN 1 ELSE 0 END), 0) AS tickets_failed
    FROM ticket t WHERE t.project_id IN (${s.projList})
    ${s.tagFilter}
  `)!
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate with recursive CTE
function queryDaily(db: Db, s: AnalyticsScope): DailyRow[] {
  return db.all<DailyRow>(sql`
    WITH RECURSIVE dates(d) AS (
      SELECT ${s.cutoff}
      UNION ALL
      SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
    ),
    sd AS (
      SELECT s.id, s.status, s.cost_usd, date(s.started_at) AS day
      FROM session s JOIN ticket t ON s.ticket_id = t.id
      WHERE t.project_id IN (${s.projList}) AND date(s.started_at) >= ${s.cutoff}
      ${s.agentFilter}
      ${s.tagFilter}
    ),
    sm AS (
      SELECT sd.day, COALESCE(SUM(a.tokens_in),0) AS tokens_in, COALESCE(SUM(a.tokens),0) AS tokens_out
      FROM sd JOIN activity a ON a.session_id = sd.id
      GROUP BY sd.day
    )
    SELECT
      dates.d AS date,
      COUNT(sd.id) AS sessions,
      COALESCE(SUM(CASE WHEN sd.status = 'finished' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN sd.status = 'failed'   THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(sd.cost_usd), 0) AS cost_usd,
      COALESCE(sm.tokens_in, 0) AS tokens_in,
      COALESCE(sm.tokens_out, 0) AS tokens_out,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id IN (${s.projList}) AND date(t.created_at) = dates.d ${s.tagFilter}) AS tickets_created,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id IN (${s.projList}) AND t.status = 'finished' AND date(t.updated_at) = dates.d ${s.tagFilter}) AS tickets_completed
    FROM dates
    LEFT JOIN sd ON sd.day = dates.d
    LEFT JOIN sm ON sm.day = dates.d
    GROUP BY dates.d
    ORDER BY dates.d
  `)
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate with subquery
function queryAgents(db: Db, s: AnalyticsScope): AgentRow[] {
  return db.all<AgentRow>(sql`
    SELECT
      a.id AS agent_id, a.name AS agent_name,
      a.created_at AS agent_created_at,
      a.superseded_at AS agent_superseded_at,
      COUNT(*) AS sessions,
      COALESCE(SUM(CASE WHEN s.status = 'finished' THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN s.status = 'failed'   THEN 1 ELSE 0 END), 0) AS sessions_failed,
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
      FROM activity GROUP BY session_id
    ) m_agg ON m_agg.session_id = s.id
    WHERE t.project_id IN (${s.projList}) AND date(s.started_at) >= ${s.cutoff}
    ${s.agentFilter}
    ${s.tagFilter}
    GROUP BY a.id
    ORDER BY cost_usd DESC
  `)
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate with json_each + subquery
function queryTags(db: Db, s: AnalyticsScope): TagRow[] {
  return db.all<TagRow>(sql`
    SELECT
      tj.value AS tag,
      COUNT(DISTINCT t.id) AS tickets,
      COUNT(DISTINCT CASE WHEN t.status = 'finished' THEN t.id END) AS tickets_done,
      COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN t.id END) AS tickets_failed,
      COUNT(DISTINCT s.id) AS sessions,
      COALESCE(SUM(s.cost_usd), 0) AS cost_usd,
      COALESCE(SUM(m_agg.tokens_in), 0) AS tokens_in,
      COALESCE(SUM(m_agg.tokens_out), 0) AS tokens_out,
      COALESCE(SUM(s.duration_ms), 0) AS duration_ms
    FROM ticket t, json_each(t.tags) AS tj
    LEFT JOIN session s ON s.ticket_id = t.id AND date(s.started_at) >= ${s.cutoff}
    LEFT JOIN (
      SELECT session_id, SUM(tokens_in) AS tokens_in, SUM(tokens) AS tokens_out
      FROM activity GROUP BY session_id
    ) m_agg ON m_agg.session_id = s.id
    WHERE t.project_id IN (${s.projList})
    ${s.tagFilter}
    GROUP BY tj.value
    ORDER BY tickets DESC
  `)
}

// eslint-disable-next-line max-lines-per-function -- single SQL aggregate joining 4 tables
function queryTools(db: Db, s: AnalyticsScope): ToolRow[] {
  return db.all<ToolRow>(sql`
    SELECT
      a.id   AS agent_id,
      a.name AS agent_name,
      a.created_at AS agent_created_at,
      e.tool_name AS name,
      COUNT(*) AS calls,
      COALESCE(SUM(CASE WHEN e.exit_code = 0 THEN 1 ELSE 0 END), 0) AS ok,
      COALESCE(SUM(CASE WHEN e.exit_code != 0 AND e.exit_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS fail,
      COALESCE(SUM(e.duration_ms), 0) AS duration_ms
    FROM execution e
    JOIN session s ON s.id = e.session_id
    JOIN ticket  t ON t.id = s.ticket_id
    JOIN agent   a ON a.id = s.agent_id
    WHERE t.project_id IN (${s.projList}) AND date(s.started_at) >= ${s.cutoff}
      AND e.tool_name IS NOT NULL
      ${s.agentFilter}
      ${s.tagFilter}
    GROUP BY a.id, e.tool_name
    ORDER BY a.created_at, a.id, calls DESC
  `)
}

interface SummaryRow {
  total_cost_usd: number; total_sessions: number
  sessions_done: number; sessions_failed: number; sessions_running: number
  total_tokens_in: number; total_tokens_out: number; total_duration_ms: number
  total_exec_count: number; total_cpu_ms: number; total_net_bytes: number
  peak_memory_mb: number | null
}

interface TicketCountsRow {
  total_tickets: number; tickets_open: number; tickets_done: number; tickets_failed: number
}

interface DailyRow {
  date: string; sessions: number; sessions_done: number; sessions_failed: number
  cost_usd: number; tokens_in: number; tokens_out: number
  tickets_created: number; tickets_completed: number
}

interface AgentRow {
  agent_id: string; agent_name: string
  agent_created_at: string; agent_superseded_at: string | null
  sessions: number; sessions_done: number; sessions_failed: number
  cost_usd: number; tokens_in: number; tokens_out: number
  duration_ms: number; avg_duration_ms: number; avg_cost_usd: number
}

interface TagRow {
  tag: string; tickets: number; tickets_done: number; tickets_failed: number
  sessions: number; cost_usd: number; tokens_in: number; tokens_out: number; duration_ms: number
}

interface ToolRow {
  agent_id: string; agent_name: string
  agent_created_at: string
  name: string
  calls: number; ok: number; fail: number; duration_ms: number
}

// eslint-disable-next-line max-lines-per-function -- inline SQL aggregate; splitting moves the WHERE clause off-screen
export function tagsList(db: Db, accountId: string): Result<string[], AnalyticsError> {
  const ownedIds = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  if (ownedIds.length === 0) return ok([])
  const projList = sql.join(ownedIds.map(id => sql`${id}`), sql`, `)
  const rows = db.all<{ tag: string }>(sql`
    SELECT DISTINCT tj.value AS tag
    FROM ticket t, json_each(t.tags) AS tj
    WHERE t.project_id IN (${projList})
    ORDER BY tj.value
  `)
  return ok(rows.map(r => r.tag))
}

// eslint-disable-next-line max-lines-per-function -- canonical zero shape; inlining avoids drift between summary fields
function emptyAnalytics(): AnalyticsResult {
  return {
    summary: {
      total_cost_usd: 0, total_sessions: 0, sessions_done: 0, sessions_failed: 0, sessions_running: 0,
      total_tokens_in: 0, total_tokens_out: 0, total_duration_ms: 0,
      total_exec_count: 0, total_cpu_ms: 0, total_net_bytes: 0, peak_memory_mb: null,
      total_tickets: 0, tickets_open: 0, tickets_done: 0, tickets_failed: 0,
    },
    daily: [], agents: [], tags: [], tools: [],
  }
}
