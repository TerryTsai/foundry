// Swallow any throw that escapes the inner stack. Outermost layer — the
// inner middlewares (session-lifecycle, ticket-fail-on-crash,
// synthetic-fail-verdict) have already recorded the failure in their own
// rows before the throw reaches here. After this wraps a stack the
// session becomes a total function: it always returns a context, and the
// orchestrator reads success by looking at ctx.result (producer) or the
// verdict row (verifier), never by catching.

import type { Middleware } from './compose.js'

export const catchCrash: Middleware = (next) => async (ctx) => {
  try { await next(ctx) } catch { /* inner layers already persisted the failure */ }
  return ctx
}
