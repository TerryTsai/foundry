// Wiring for @foundry/engine. createEngineService binds db + config +
// the EngineDeps bag (constructed by the composition root) and returns
// an EngineClient. runSession needs loaded Agent and Ticket rows; this
// resolves them via the crud callbacks already on engineDeps.
//
// The legacy EngineDeps shape will collapse into typed clients in the
// phase-2 async-Result conversion of the engine internals; for now the
// service preserves the existing wiring contract while exposing the
// per-service entry point.

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
  runSession: async (_ctx, args): Promise<Result<void, EngineError>> => {
    const agent  = deps.engineDeps.crud.agentGetById(deps.db, args.agentId)
    if (!agent)  return err({ kind: 'not_found', entity: 'agent', id: args.agentId })
    const ticket = deps.engineDeps.crud.ticketGetById(deps.db, args.ticketId)
    if (!ticket) return err({ kind: 'not_found', entity: 'ticket', id: args.ticketId })
    return runSessionInternal(deps.db, deps.config, deps.engineDeps, args.sessionId, agent, ticket, args.role)
  },
})
