import type { Client } from '../types.js'

// Build an in-process Client from per-module adapter implementations.
// Each module's migration phase fills in its slice; until then the
// adapter is empty and any method call would be undefined.
//
// Usage in the composition root (server):
//   const client = createInProcessClient({
//     auth:       authAdapter(deps),
//     crud:       crudAdapter(deps),
//     ...
//   })
//   const c = bind(client, ctxFromRequest(req))
//   await c.crud.ticketCreate(args)

export type InProcessAdapters = {
  auth:       Client['auth']
  billing:    Client['billing']
  crud:       Client['crud']
  analytics:  Client['analytics']
  sandbox:    Client['sandbox']
  mcp:        Client['mcp']
  engine:     Client['engine']
  reconciler: Client['reconciler']
}

export const createInProcessClient = (adapters: InProcessAdapters): Client => ({
  auth:       adapters.auth,
  billing:    adapters.billing,
  crud:       adapters.crud,
  analytics:  adapters.analytics,
  sandbox:    adapters.sandbox,
  mcp:        adapters.mcp,
  engine:     adapters.engine,
  reconciler: adapters.reconciler,
})

// Empty adapter. Use as a placeholder for slices not yet migrated; the
// composition root passes this for any module whose impl isn't wired up
// yet.
export const emptyAdapter = <S>(): S => ({} as S)
