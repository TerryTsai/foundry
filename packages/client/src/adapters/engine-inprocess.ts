// In-process adapter for the engine slice. runSession needs loaded Agent
// and Ticket rows; the adapter resolves them from db ids before invoking.

import type { Db } from '@foundry/db'
import type { EngineError, Result } from '@foundry/model'
import { err } from '@foundry/model'
import * as engine from '@foundry/engine'
import type { EngineConfig, EngineDeps } from '@foundry/engine'
import { agentGetById, ticketGetById } from '@foundry/crud'

import type { EngineSlice } from '../slices/engine.js'

export type EngineAdapterDeps = {
  db:         Db
  config:     EngineConfig
  engineDeps: EngineDeps
}

export const createEngineAdapter = (deps: EngineAdapterDeps): EngineSlice => ({
  runSession: async (_ctx, args): Promise<Result<void, EngineError>> => {
    const agent  = agentGetById(deps.db,  args.agentId)
    if (!agent)  return err({ kind: 'not_found', entity: 'agent', id: args.agentId })
    const ticket = ticketGetById(deps.db, args.ticketId)
    if (!ticket) return err({ kind: 'not_found', entity: 'ticket', id: args.ticketId })
    return engine.runSession(deps.db, deps.config, deps.engineDeps, args.sessionId, agent, ticket, args.role)
  },
})
