// Cross-module surface for @foundry/analytics. Aggregate queries over
// sessions, tickets, and executions; per-entity usage rollups.

import type { Ctx, Result, AnalyticsError } from '@foundry/model'

export type AnalyticsArgs = {
  days:      number
  projectId?: string
  agentId?:   string
  tag?:       string
}

// The analytics aggregate shape is intentionally open (the service builds
// it out of multiple SQL queries; pinning it here would just churn). The
// route layer JSON-serializes it as-is.
export type AnalyticsResult = {
  summary: Record<string, unknown>
  daily:   unknown[]
  agents:  unknown[]
  tags:    unknown[]
  tools:   unknown[]
}

export type UsageRollup = {
  session_count:  number
  tokens_in:      number
  tokens_out:     number
  duration_ms:    number
  step_count:     number
  tool_calls:     number
  exec_count:     number
  cpu_ms:         number
  peak_memory_mb: number | null
  net_bytes:      number
}

export type AnalyticsSlice = {
  analytics:    (ctx: Ctx, args: AnalyticsArgs) => Promise<Result<AnalyticsResult, AnalyticsError>>
  tagsList:     (ctx: Ctx)                      => Promise<Result<string[], AnalyticsError>>
  ticketUsage:  (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
  agentUsage:   (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
  sessionUsage: (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
}
