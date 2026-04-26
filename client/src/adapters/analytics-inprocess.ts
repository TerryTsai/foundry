// In-process adapter for the analytics slice. Underlying functions return
// Result natively.

import type { Db } from '@foundry/db'
import * as analytics from '@foundry/analytics'

import type { AnalyticsSlice } from '../slices/analytics.js'

export type AnalyticsAdapterDeps = { db: Db }

export const createAnalyticsAdapter = (deps: AnalyticsAdapterDeps): AnalyticsSlice => ({
  // The analytics module's AnalyticsResult is structurally compatible with the
  // open slice shape; cast at the adapter to bridge the named-vs-open type.
  analytics:    async (ctx, args) => analytics.analytics(deps.db, ctx.accountId, args) as unknown as Awaited<ReturnType<AnalyticsSlice['analytics']>>,
  tagsList:     async (ctx)       => analytics.tagsList(deps.db, ctx.accountId),
  ticketUsage:  async (_ctx, id)  => analytics.ticketUsage(deps.db, id),
  agentUsage:   async (_ctx, id)  => analytics.agentUsage(deps.db, id),
  sessionUsage: async (_ctx, id)  => analytics.sessionUsage(deps.db, id),
})
