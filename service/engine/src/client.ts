// Cross-service contract for @foundry/engine. Types only — no value
// imports beyond schema.ts and @foundry/model. The engine is driven by
// the reconciler tick — runSession is the only client-visible entry
// point, and even that is rare from HTTP. Pipeline middleware and
// engine adapters are internal.

import type { Ctx, Result } from '@foundry/model'

import type { EngineError } from './schema.js'

export type RunSessionArgs = {
  sessionId: string
  agentId:   string
  ticketId:  string
  role:      'producer' | 'verifier'
}

export type EngineClient = {
  runSession: (ctx: Ctx, args: RunSessionArgs) => Promise<Result<void, EngineError>>
}
