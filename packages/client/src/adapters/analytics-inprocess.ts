// In-process adapter for the analytics slice.

import type { Db } from '@foundry/db'
import type { AppError, AnalyticsError } from '@foundry/model'
import * as analytics from '@foundry/analytics'

import type { AnalyticsSlice } from '../slices/analytics.js'
import { wrap } from './wrap.js'

export type AnalyticsAdapterDeps = { db: Db }

const toAnalyticsError = (e: AppError): AnalyticsError => {
  if (e.status === 400) return { kind: 'invalid_query', reason: e.message }
  return { kind: 'internal', message: e.message }
}

const w = <T>(fn: () => T | Promise<T>) => wrap<T, AnalyticsError>(fn, toAnalyticsError)

export const createAnalyticsAdapter = (deps: AnalyticsAdapterDeps): AnalyticsSlice => ({
  analytics:    (ctx, args) => w(() => analytics.analytics(deps.db, ctx.accountId, args)),
  tagsList:     (ctx)       => w(() => analytics.tagsList(deps.db, ctx.accountId)),
  ticketUsage:  (_ctx, id)  => w(() => analytics.ticketUsage(deps.db, id)),
  agentUsage:   (_ctx, id)  => w(() => analytics.agentUsage(deps.db, id)),
  sessionUsage: (_ctx, id)  => w(() => analytics.sessionUsage(deps.db, id)),
})
