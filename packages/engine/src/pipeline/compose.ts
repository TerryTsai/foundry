// Middleware types and composition. A session runs as a Koa-style onion:
// each middleware does setup, awaits next(ctx), then tears down. The
// innermost layer is the atomic agent-loop invocation.

import type { SessionContext } from '../types.js'

export type { SessionContext, LoopResult } from '../types.js'

export type SessionStep = (ctx: SessionContext) => Promise<SessionContext>
export type Middleware  = (next: SessionStep) => SessionStep

// Compose middleware around a base step. The first middleware listed is
// the outermost onion layer (sees the whole call including downstream
// throws); the last is closest to the base step.
export const compose = (...mws: Middleware[]) => (base: SessionStep): SessionStep =>
  mws.reduceRight((next, mw) => mw(next), base)
