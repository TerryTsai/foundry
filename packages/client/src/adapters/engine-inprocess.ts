// In-process adapter for the engine slice. runSession needs loaded Agent
// and Ticket rows; the adapter resolves them from db ids before invoking.

import type { Db } from '@foundry/db'
import type { AppError, EngineError } from '@foundry/model'
import * as engine from '@foundry/engine'
import type { EngineConfig, EngineDeps } from '@foundry/engine'
import { agentGetById, ticketGetById } from '@foundry/crud'

import type { EngineSlice } from '../slices/engine.js'
import { wrap } from './wrap.js'

export type EngineAdapterDeps = {
  db:         Db
  config:     EngineConfig
  engineDeps: EngineDeps
}

const toEngineError = (e: AppError): EngineError =>
  ({ kind: 'crashed', message: e.message })

const w = <T>(fn: () => T | Promise<T>) => wrap<T, EngineError>(fn, toEngineError)

export const createEngineAdapter = (deps: EngineAdapterDeps): EngineSlice => ({
  runSession: (_ctx, args) => w(async () => {
    const agent  = agentGetById(deps.db,  args.agentId)
    const ticket = ticketGetById(deps.db, args.ticketId)
    if (!agent)  throw Object.assign(new Error(`agent ${args.agentId} not found`),   { status: 404, _tag: 'AppError' as const })
    if (!ticket) throw Object.assign(new Error(`ticket ${args.ticketId} not found`), { status: 404, _tag: 'AppError' as const })
    await engine.runSession(deps.db, deps.config, deps.engineDeps, args.sessionId, agent, ticket, args.role)
  }),
})
