// Composition helper. A session runs as a Koa-style onion: each
// middleware does setup, awaits next(ctx), then tears down. The
// innermost layer is the atomic agent-loop invocation.
//
// Types (SessionStep, Middleware, SessionContext) live in
// engine/types.ts; this file only owns the composition function.

import type { Middleware, SessionStep } from '../schema.js'

// Compose middleware around a base step. The first middleware listed is
// the outermost onion layer (sees the whole call including downstream
// throws); the last is closest to the base step.
export function compose(...mws: Middleware[]): (base: SessionStep) => SessionStep {
  return (base) => mws.reduceRight((next, mw) => mw(next), base)
}
