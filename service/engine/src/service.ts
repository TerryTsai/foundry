// Wiring for @foundry/engine. createEngineService binds db + config +
// the EngineDeps bag (constructed by the composition root) and returns
// an EngineClient. runSession needs loaded Agent and Ticket rows; this
// resolves them via the crud client on engineDeps.

import type { Db } from '@foundry/db'
import type { Result } from '@foundry/model'
import { err } from '@foundry/model'

import { runSession as runSessionInternal } from './session.js'
import type { EngineConfig, EngineDeps, EngineError } from './schema.js'
import type { EngineClient } from './client.js'

export type EngineServiceDeps = {
  db:         Db
  config:     EngineConfig
  engineDeps: EngineDeps
}

export const createEngineService = (deps: EngineServiceDeps): EngineClient => ({
  runSession: async (ctx, args): Promise<Result<void, EngineError>> => {
    const agentR = await deps.engineDeps.crud.agentGetById(ctx, args.agentId)
    if (!agentR.ok)   return err({ kind: 'crashed', message: `agentGetById: ${agentR.error.message}` })
    if (!agentR.value) return err({ kind: 'not_found', entity: 'agent', id: args.agentId })
    const ticketR = await deps.engineDeps.crud.ticketGetById(ctx, args.ticketId)
    if (!ticketR.ok)   return err({ kind: 'crashed', message: `ticketGetById: ${ticketR.error.message}` })
    if (!ticketR.value) return err({ kind: 'not_found', entity: 'ticket', id: args.ticketId })
    return runSessionInternal(ctx, deps.db, deps.config, deps.engineDeps, args.sessionId, agentR.value, ticketR.value, args.role)
  },
})
