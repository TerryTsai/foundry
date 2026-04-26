// Cross-module surface for @foundry/engine. The engine is driven by the
// reconciler tick — runSession is the only client-visible entry point, and
// even that is rare from HTTP. Pipeline middleware and engine adapters are
// internal.

import type { Ctx, Result, EngineError } from '@foundry/model'

export type RunSessionArgs = {
  sessionId: string
  agentId:   string
  ticketId:  string
  role:      'producer' | 'verifier'
}

export type EngineSlice = {
  runSession: (ctx: Ctx, args: RunSessionArgs) => Promise<Result<void, EngineError>>
}
