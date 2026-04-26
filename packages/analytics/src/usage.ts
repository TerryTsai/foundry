import { eq } from 'drizzle-orm'

import { type Db } from '@foundry/db'
import * as database from '@foundry/db'
import * as schema from '@foundry/db'
import type { Execution } from '@foundry/db'
import type { Result, AnalyticsError } from '@foundry/model'
import { ok, err } from '@foundry/model'

import type { UsageRollup, SessionUsageRow, SessionTotals } from './schema.js'

function rollupExecutions(executions: Execution[]): { exec_count: number; cpu_ms: number; peak_memory_mb: number | null; net_bytes: number } {
  let cpu_ms = 0, net_bytes = 0, peak = 0
  for (const e of executions) {
    cpu_ms += e.cpu_ms ?? 0
    net_bytes += (e.net_rx_bytes ?? 0) + (e.net_tx_bytes ?? 0)
    if ((e.peak_memory_mb ?? 0) > peak) peak = e.peak_memory_mb ?? 0
  }
  return { exec_count: executions.length, cpu_ms, peak_memory_mb: peak || null, net_bytes }
}


function rollupSessions(db: Db, sessions: SessionUsageRow[]): UsageRollup {
  const t: SessionTotals = { tokens_in: 0, tokens_out: 0, duration_ms: 0, step_count: 0, tool_calls: 0, cpu_ms: 0, net_bytes: 0, peak: 0, exec_count: 0 }
  for (const s of sessions) accumulateSession(db, t, s)
  return totalsToRollup(sessions.length, t)
}

function accumulateSession(db: Db, t: SessionTotals, s: SessionUsageRow): void {
  t.tokens_in   += s.tokens_in   ?? 0
  t.tokens_out  += s.tokens_out  ?? 0
  t.duration_ms += s.duration_ms ?? 0
  t.step_count  += s.step_count  ?? 0
  t.tool_calls  += s.tool_calls  ?? 0
  const e = rollupExecutions(database.executionBySession(db, s.id))
  t.cpu_ms += e.cpu_ms; t.net_bytes += e.net_bytes; t.exec_count += e.exec_count
  if ((e.peak_memory_mb ?? 0) > t.peak) t.peak = e.peak_memory_mb ?? 0
}

function totalsToRollup(sessionCount: number, t: SessionTotals): UsageRollup {
  return {
    session_count: sessionCount,
    tokens_in: t.tokens_in, tokens_out: t.tokens_out,
    duration_ms: t.duration_ms, step_count: t.step_count, tool_calls: t.tool_calls,
    exec_count: t.exec_count, cpu_ms: t.cpu_ms,
    peak_memory_mb: t.peak || null, net_bytes: t.net_bytes,
  }
}

export function ticketUsage(db: Db, id: string): Result<UsageRollup, AnalyticsError> {
  if (!database.ticketGet(db, id)) return err({ kind: 'not_found', entity: 'ticket', id })
  return ok(rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.ticket_id, id)])))
}

export function agentUsage(db: Db, id: string): Result<UsageRollup, AnalyticsError> {
  if (!database.agentGet(db, id)) return err({ kind: 'not_found', entity: 'agent', id })
  return ok(rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.agent_id, id)])))
}

export function sessionUsage(db: Db, id: string): Result<UsageRollup, AnalyticsError> {
  const s = database.sessionGetAggregated(db, id)
  if (!s) return err({ kind: 'not_found', entity: 'session', id })
  return ok(rollupSessions(db, [s]))
}
