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

export { createHttpAdapter } from './adapters/http.js'
export type { HttpAdapterConfig } from './adapters/http.js'

// In-process module adapters. Composition root constructs each one with
// its dependency bag and assembles the full Client via createInProcessClient.
export { createAuthAdapter }       from './adapters/auth-inprocess.js'
export type { AuthAdapterDeps }    from './adapters/auth-inprocess.js'
export { createBillingAdapter }    from './adapters/billing-inprocess.js'
export { createCrudAdapter }       from './adapters/crud-inprocess.js'
export type { CrudAdapterDeps }    from './adapters/crud-inprocess.js'
export { createAnalyticsAdapter }  from './adapters/analytics-inprocess.js'
export type { AnalyticsAdapterDeps } from './adapters/analytics-inprocess.js'
export { createSandboxAdapter }    from './adapters/sandbox-inprocess.js'
export type { SandboxAdapterDeps } from './adapters/sandbox-inprocess.js'
export { createMcpAdapter }        from './adapters/mcp-inprocess.js'
export type { McpAdapterDeps }     from './adapters/mcp-inprocess.js'
export { createEngineAdapter }     from './adapters/engine-inprocess.js'
export type { EngineAdapterDeps }  from './adapters/engine-inprocess.js'
export { createReconcilerAdapter } from './adapters/reconciler-inprocess.js'
