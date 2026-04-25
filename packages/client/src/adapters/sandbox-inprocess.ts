// In-process adapter for the sandbox slice. Cross-module ownership
// callbacks (executionOwned, sessionOwned) are injected — sandbox itself
// can't import @foundry/crud, so the composition root binds those.

import type { Db } from '@foundry/db'
import type { AppError, SandboxError } from '@foundry/model'
import * as sandbox from '@foundry/sandbox'
import type {
  IsExecutionOwned, IsSessionOwned, SandboxConfig, SandboxCrudOps,
} from '@foundry/sandbox'

import type { SandboxSlice } from '../slices/sandbox.js'
import { wrap } from './wrap.js'

export type SandboxAdapterDeps = {
  db:               Db
  config:           SandboxConfig
  executionOwned:   IsExecutionOwned
  sessionOwned:     IsSessionOwned
  sandboxCrud:      SandboxCrudOps
}

const toSandboxError = (e: AppError): SandboxError => {
  switch (e.status) {
    case 404: return { kind: 'not_found',             id: '' }
    case 409:
    case 400: return { kind: 'container_unavailable', reason: e.message }
    default:  return { kind: 'internal',              message: e.message }
  }
}

const w = <T>(fn: () => T | Promise<T>) => wrap<T, SandboxError>(fn, toSandboxError)

export const createSandboxAdapter = (deps: SandboxAdapterDeps): SandboxSlice => ({
  executionList:      (ctx)             => w(() => sandbox.executionList(deps.db, ctx.accountId, deps.sandboxCrud)),
  executionGet:       (ctx, id)         => w(() => sandbox.executionGet(deps.db, ctx.accountId, id, deps.executionOwned)),
  executionBySession: (ctx, sessionId)  => w(() => sandbox.executionBySession(deps.db, ctx.accountId, sessionId, deps.sessionOwned, deps.sandboxCrud)),
  executionCreate:    (_ctx, input)     => w(() => {
    const { id } = sandbox.executionCreate(deps.db, deps.config, deps.sandboxCrud, input)
    return { id }
  }),
  executionKill:      (ctx, id)         => w(() => sandbox.executionKill(deps.db, ctx.accountId, id, deps.executionOwned, deps.sandboxCrud)),
})
