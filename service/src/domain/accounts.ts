import { eq, sql } from 'drizzle-orm'
import { type Db } from '../database.js'
import * as database from '../database.js'
import * as schema from '../schema.js'

// Account-level analytics. Aggregates across every project the account
// owns, with optional narrowing by projectId and/or agentId. Same return
// shape as projectAnalytics so a single UI can render both.
export function accountAnalytics(db: Db, accountId: string, opts: { days: number; projectId?: string; agentId?: string }) {
  const { days } = opts
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  // Scope to projects this account owns. Empty list = zero aggregates (not
  // a leak of other accounts' data).
  const ownedIds = database.projectAll(db, [eq(schema.project.owner_id, accountId)]).map(p => p.id)
  const projectIds = opts.projectId
    ? (ownedIds.includes(opts.projectId) ? [opts.projectId] : [])
    : ownedIds
  if (projectIds.length === 0) {
    return {
      summary: {
        total_cost_usd: 0, total_sessions: 0, sessions_done: 0, sessions_failed: 0, sessions_running: 0,
        total_tokens_in: 0, total_tokens_out: 0, total_duration_ms: 0,
        total_exec_count: 0, total_cpu_ms: 0, total_net_bytes: 0, peak_memory_mb: null,
        total_tickets: 0, tickets_open: 0, tickets_done: 0, tickets_failed: 0,
      },
      daily: [], agents: [], tags: [],
    }
  }

  const projList = sql.join(projectIds.map(id => sql`${id}`), sql`, `)
  const agentFilter = opts.agentId ? sql`AND s.agent_id = ${opts.agentId}` : sql``
  const agentFilterExec = opts.agentId ? sql`AND s.agent_id = ${opts.agentId}` : sql``

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
      WHERE t.project_id IN (${projList}) AND date(s.started_at) >= ${cutoff}
      ${agentFilter}
    )
    SELECT
      COALESCE(SUM(rs.cost_usd), 0) AS total_cost_usd,
      COUNT(*) AS total_sessions,
      COALESCE(SUM(CASE WHEN rs.status = 'done'    THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN rs.status = 'failed'  THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(CASE WHEN rs.status = 'running' THEN 1 ELSE 0 END), 0) AS sessions_running,
      COALESCE(SUM(rs.duration_ms), 0) AS total_duration_ms,
      COALESCE((SELECT SUM(m.tokens_in) FROM message m   WHERE m.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_in,
      COALESCE((SELECT SUM(m.tokens)    FROM message m   WHERE m.session_id IN (SELECT id FROM rs)), 0) AS total_tokens_out,
      COALESCE((SELECT COUNT(*)         FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_exec_count,
      COALESCE((SELECT SUM(e.cpu_ms)    FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_cpu_ms,
      COALESCE((SELECT SUM(COALESCE(e.net_rx_bytes,0)+COALESCE(e.net_tx_bytes,0)) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)), 0) AS total_net_bytes,
      (SELECT MAX(e.peak_memory_mb) FROM execution e WHERE e.session_id IN (SELECT id FROM rs)) AS peak_memory_mb
    FROM rs
  `)!

  // Ticket counts ignore the agent filter on purpose — tickets aren't
  // session-level and the founder needs a stable "work in this project" view.
  const tickets = db.get<{
    total_tickets: number; tickets_open: number; tickets_done: number; tickets_failed: number
  }>(sql`
    SELECT
      COUNT(*) AS total_tickets,
      COALESCE(SUM(CASE WHEN status IN ('open','reopened','claimed','blocked') THEN 1 ELSE 0 END), 0) AS tickets_open,
      COALESCE(SUM(CASE WHEN status = 'done'   THEN 1 ELSE 0 END), 0) AS tickets_done,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS tickets_failed
    FROM ticket WHERE project_id IN (${projList})
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
      WHERE t.project_id IN (${projList}) AND date(s.started_at) >= ${cutoff}
      ${agentFilter}
    ),
    sm AS (
      SELECT sd.day, COALESCE(SUM(m.tokens_in),0) AS tokens_in, COALESCE(SUM(m.tokens),0) AS tokens_out
      FROM sd JOIN message m ON m.session_id = sd.id
      GROUP BY sd.day
    )
    SELECT
      dates.d AS date,
      COUNT(sd.id) AS sessions,
      COALESCE(SUM(CASE WHEN sd.status = 'done'   THEN 1 ELSE 0 END), 0) AS sessions_done,
      COALESCE(SUM(CASE WHEN sd.status = 'failed' THEN 1 ELSE 0 END), 0) AS sessions_failed,
      COALESCE(SUM(sd.cost_usd), 0) AS cost_usd,
      COALESCE(sm.tokens_in, 0) AS tokens_in,
      COALESCE(sm.tokens_out, 0) AS tokens_out,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id IN (${projList}) AND date(t.created_at) = dates.d) AS tickets_created,
      (SELECT COUNT(*) FROM ticket t WHERE t.project_id IN (${projList}) AND t.status = 'done' AND date(t.updated_at) = dates.d) AS tickets_completed
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
      COALESCE(SUM(CASE WHEN s.status = 'done'   THEN 1 ELSE 0 END), 0) AS sessions_done,
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
    WHERE t.project_id IN (${projList}) AND date(s.started_at) >= ${cutoff}
    ${agentFilterExec}
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
      COUNT(DISTINCT CASE WHEN t.status = 'done'   THEN t.id END) AS tickets_done,
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
    WHERE t.project_id IN (${projList})
    GROUP BY tt.tag
    ORDER BY tickets DESC
  `)

  return { summary: { ...summary, ...tickets }, daily, agents, tags }
}
