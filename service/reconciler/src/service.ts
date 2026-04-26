// Wiring for @foundry/reconciler. Lifecycle is owned here: createReconcilerService
// allocates and returns the per-tick handle the composition root invokes on
// its setInterval and on SIGTERM. The cross-service ReconcilerClient stays
// empty (no other service calls reconciler today); the runtime handle is
// what server actually needs.

import type { Db } from '@foundry/db'

import { reconcilerTick, shutdownDrain } from './reconciler.js'
import type { ReconcilerDeps, Policy } from './schema.js'
import type { ReconcilerClient } from './client.js'

export type ReconcilerServiceDeps = {
  db:       Db
  deps:     ReconcilerDeps
  policies: Policy[]
}

export type ReconcilerService = {
  client: ReconcilerClient
  tick:   () => Promise<void>
  drain:  () => void
}

export const createReconcilerService = (deps: ReconcilerServiceDeps): ReconcilerService => ({
  client: {},
  tick:   () => reconcilerTick(deps.db, deps.deps, deps.policies),
  drain:  () => shutdownDrain(deps.db, deps.deps),
})
