// Shapes for @foundry/analytics. Types only — zod validators live in
// validate.ts and are re-exported below for legacy import paths during
// the @foundry/client → per-service migration.

import type { SQL } from 'drizzle-orm'

export type { AnalyticsArgs } from './validate.js'

// ── Internal scope ───────────────────────────────────────────────────

export interface AnalyticsScope {
  projList:    SQL
  agentFilter: SQL
  tagFilter:   SQL
  cutoff:      string
}

// ── Result rows ──────────────────────────────────────────────────────

export interface SummaryRow {
  total_cost_usd: number; total_sessions: number
  sessions_done: number; sessions_failed: number; sessions_running: number
  total_tokens_in: number; total_tokens_out: number; total_duration_ms: number
  total_exec_count: number; total_cpu_ms: number; total_net_bytes: number
  peak_memory_mb: number | null
}

export interface TicketCountsRow {
  total_tickets: number; tickets_open: number; tickets_done: number; tickets_failed: number
}

export interface DailyRow {
  date: string; sessions: number; sessions_done: number; sessions_failed: number
  cost_usd: number; tokens_in: number; tokens_out: number
  tickets_created: number; tickets_completed: number
}

export interface AgentRow {
  agent_id: string; agent_name: string
  agent_created_at: string; agent_superseded_at: string | null
  sessions: number; sessions_done: number; sessions_failed: number
  cost_usd: number; tokens_in: number; tokens_out: number
  duration_ms: number; avg_duration_ms: number; avg_cost_usd: number
}

export interface TagRow {
  tag: string; tickets: number; tickets_done: number; tickets_failed: number
  sessions: number; cost_usd: number; tokens_in: number; tokens_out: number; duration_ms: number
}

export interface ToolRow {
  agent_id: string; agent_name: string
  agent_created_at: string
  name: string
  calls: number; ok: number; fail: number; duration_ms: number
}

export interface AnalyticsResult {
  summary: SummaryRow & TicketCountsRow
  daily:   DailyRow[]
  agents:  AgentRow[]
  tags:    TagRow[]
  tools:   ToolRow[]
}

// ── Usage rollup (per-session) ──────────────────────────────────────

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

export interface SessionUsageRow {
  id:          string
  duration_ms: number | null
  tokens_in:   number | null
  tokens_out:  number | null
  step_count:  number | null
  tool_calls:  number | null
}

export interface SessionTotals {
  tokens_in: number; tokens_out: number; duration_ms: number; step_count: number; tool_calls: number
  cpu_ms: number; net_bytes: number; peak: number; exec_count: number
}

// ── Error union ─────────────────────────────────────────────────────

export type AnalyticsError =
  | { kind: 'invalid_query';   reason: string }
  | { kind: 'not_found';       entity: string; id: string }
  | { kind: 'internal';        message: string }
