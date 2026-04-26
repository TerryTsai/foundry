// Cross-service contract for @foundry/analytics. Types only — no value
// imports beyond schema.ts and @foundry/model.

import type { Ctx, Result } from '@foundry/model'

import type { AnalyticsArgs, AnalyticsResult, UsageRollup, AnalyticsError } from './schema.js'

export type AnalyticsClient = {
  analytics:    (ctx: Ctx, args: AnalyticsArgs) => Promise<Result<AnalyticsResult, AnalyticsError>>
  tagsList:     (ctx: Ctx)                      => Promise<Result<string[], AnalyticsError>>
  ticketUsage:  (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
  agentUsage:   (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
  sessionUsage: (ctx: Ctx, id: string)          => Promise<Result<UsageRollup, AnalyticsError>>
}
