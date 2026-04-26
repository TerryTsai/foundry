// Swallow any throw that escapes the inner stack. Outermost layer — the
// inner middlewares (record-session, fail-ticket-on-crash,
// fail-verdict-on-silence) have already recorded the failure in their
// own rows before the throw reaches here. After this wraps a stack the
// session becomes a total function: it always returns a context, and the
// orchestrator reads success by looking at ctx.result (producer) or the
// verdict row (verifier), never by catching.

import type { SessionStep } from '../types.js'

export function catchCrash(next: SessionStep): SessionStep {
  return async (ctx) => {
    try { await next(ctx) } catch { /* inner layers already persisted the failure */ }
    return ctx
  }
}
