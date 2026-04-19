// Wire activity rows to their execution rows once both exist. Runs in
// a finally so a mid-session throw still gets backfilled.

import * as database from '../../core/db.js'
import type { Middleware } from './compose.js'

export const withActivityBackfill: Middleware = (next) => async (ctx) => {
  try { return await next(ctx) }
  finally {
    try { database.backfillActivityExecutionIds(ctx.db, ctx.session.id) } catch { /* best effort */ }
  }
}
