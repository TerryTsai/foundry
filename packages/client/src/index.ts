// Public surface for @foundry/client. Two contracts cross this seam:
// (1) the Client type — what every module exposes; (2) bind() — the
// ctx-binding utility every boundary uses. See ARCHITECTURE.md.

export { bind } from './bind.js'
export type { Client, BoundClient } from './types.js'

export type { AuthSlice }       from './slices/auth.js'
export type { BillingSlice }    from './slices/billing.js'
export type { CrudSlice }       from './slices/crud.js'
export type { AnalyticsSlice }  from './slices/analytics.js'
export type { SandboxSlice }    from './slices/sandbox.js'
export type { McpSlice }        from './slices/mcp.js'
export type { EngineSlice }     from './slices/engine.js'
export type { ReconcilerSlice } from './slices/reconciler.js'

export { createInProcessClient, emptyAdapter } from './adapters/in-process.js'
export type { InProcessAdapters } from './adapters/in-process.js'
