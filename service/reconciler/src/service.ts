// Wiring for @foundry/reconciler. Lifecycle is owned here:
// createReconcilerService allocates and returns the per-tick handle the
// composition root invokes on its setInterval and on SIGTERM. The
// cross-service ReconcilerClient stays empty (no other service calls
// reconciler today); the runtime handle is what server actually needs.

import type { Db } from '@foundry/db'
import { makeCtx } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'
import type { EngineClient } from '@foundry/engine/client'

import { reconcilerTick, shutdownDrain } from './reconciler.js'
import type { Policy } from './schema.js'
import type { ReconcilerClient } from './client.js'

export type ReconcilerService = {
  client: ReconcilerClient
  tick:   () => Promise<void>
  drain:  () => Promise<void>
}

// The reconciler runs as a system actor: there is no inbound HTTP
// request to seed a ctx. We mint one per tick / drain so each crud
// call carries its own traceId for correlation.
const systemCtx = () => makeCtx({ accountId: 'system' })

export const createReconcilerService = (
  db: Db, crud: CrudClient, engine: EngineClient, policies: Policy[],
): ReconcilerService => ({
  client: {},
  tick:   () => reconcilerTick(systemCtx(), db, crud, engine, policies),
  drain:  () => shutdownDrain(systemCtx(), crud),
})
