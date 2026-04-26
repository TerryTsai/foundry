// Wiring for @foundry/analytics. Returns an AnalyticsClient backed by
// the module's pure SQL aggregate functions. Owns no runtime state.

import type { Db } from '@foundry/db'

import { analytics, tagsList } from './aggregate.js'
import { ticketUsage, agentUsage, sessionUsage } from './usage.js'
import type { AnalyticsClient } from './client.js'

export const createAnalyticsService = (deps: { db: Db }): AnalyticsClient => ({
  analytics:    async (ctx, args) => analytics(deps.db, ctx.accountId, args),
  tagsList:     async (ctx)       => tagsList(deps.db, ctx.accountId),
  ticketUsage:  async (_ctx, id)  => ticketUsage(deps.db, id),
  agentUsage:   async (_ctx, id)  => agentUsage(deps.db, id),
  sessionUsage: async (_ctx, id)  => sessionUsage(deps.db, id),
})
