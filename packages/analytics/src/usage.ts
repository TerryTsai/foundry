import { eq } from 'drizzle-orm'

import { type Db } from '@foundry/db'
import * as database from '@foundry/db'
import * as schema from '@foundry/db'
import type { Execution } from '@foundry/db'
import { mustExist } from '@foundry/model'

export interface UsageRollup {
  session_count: number
  tokens_in: number
  tokens_out: number
  duration_ms: number
  step_count: number
  tool_calls: number
  exec_count: number
  cpu_ms: number
  peak_memory_mb: number | null
  net_bytes: number
}

interface SessionUsageRow {
  id:          string
  duration_ms: number | null
  tokens_in:   number | null
  tokens_out:  number | null
  step_count:  number | null
  tool_calls:  number | null
}

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
  let tokens_in = 0, tokens_out = 0, duration_ms = 0, step_count = 0, tool_calls = 0
  let cpu_ms = 0, net_bytes = 0, peak = 0, exec_count = 0
  for (const s of sessions) {
    tokens_in   += s.tokens_in   ?? 0
    tokens_out  += s.tokens_out  ?? 0
    duration_ms += s.duration_ms ?? 0
    step_count  += s.step_count  ?? 0
    tool_calls  += s.tool_calls  ?? 0
    const e = rollupExecutions(database.executionBySession(db, s.id))
    cpu_ms    += e.cpu_ms
    net_bytes += e.net_bytes
    exec_count += e.exec_count
    if ((e.peak_memory_mb ?? 0) > peak) peak = e.peak_memory_mb ?? 0
  }
  return {
    session_count: sessions.length,
    tokens_in, tokens_out, duration_ms, step_count, tool_calls,
    exec_count, cpu_ms, peak_memory_mb: peak || null, net_bytes,
  }
}

export function ticketUsage(db: Db, id: string): UsageRollup {
  mustExist(database.ticketGet(db, id))
  return rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.ticket_id, id)]))
}

export function agentUsage(db: Db, id: string): UsageRollup {
  mustExist(database.agentGet(db, id))
  return rollupSessions(db, database.sessionAggregateAll(db, [eq(schema.session.agent_id, id)]))
}

export function sessionUsage(db: Db, id: string): UsageRollup {
  const s = mustExist(database.sessionGetAggregated(db, id))
  return rollupSessions(db, [s])
}
