import type { Ctx } from '@foundry/model'

import type { AuthSlice }       from './slices/auth.js'
import type { BillingSlice }    from './slices/billing.js'
import type { CrudSlice }       from './slices/crud.js'
import type { AnalyticsSlice }  from './slices/analytics.js'
import type { SandboxSlice }    from './slices/sandbox.js'
import type { McpSlice }        from './slices/mcp.js'
import type { EngineSlice }     from './slices/engine.js'
import type { ReconcilerSlice } from './slices/reconciler.js'

// Unbound client. Every method's first parameter is Ctx.
export type Client = {
  auth:       AuthSlice
  billing:    BillingSlice
  crud:       CrudSlice
  analytics:  AnalyticsSlice
  sandbox:    SandboxSlice
  mcp:        McpSlice
  engine:     EngineSlice
  reconciler: ReconcilerSlice
}

// Bound client. Same shape as Client, but with Ctx stripped from every
// method signature. Type-level transformation handles both Promise and
// AsyncIterable returns; non-method properties are preserved as-is.
export type BoundClient = { [K in keyof Client]: Bound<Client[K]> }

type Bound<S> = {
  [K in keyof S]:
    S[K] extends (ctx: Ctx, ...args: infer A) => infer R
      ? (...args: A) => R
      : S[K]
}
