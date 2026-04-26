// In-process adapter for the sandbox slice. Underlying functions return
// Result natively.

import type { Db } from '@foundry/db'
import * as sandbox from '@foundry/sandbox'
import type {
  IsExecutionOwned, IsSessionOwned, SandboxConfig, SandboxCrudOps, SandboxState,
} from '@foundry/sandbox'

import type { SandboxSlice } from '../slices/sandbox.js'

export type SandboxAdapterDeps = {
  db:             Db
  config:         SandboxConfig
  executionOwned: IsExecutionOwned
  sessionOwned:   IsSessionOwned
  sandboxCrud:    SandboxCrudOps
  sandboxState:   SandboxState
}

export const createSandboxAdapter = (deps: SandboxAdapterDeps): SandboxSlice => ({
  executionList:      async (ctx)             => sandbox.executionList(deps.db, ctx.accountId, deps.sandboxCrud),
  executionGet:       async (ctx, id)         => sandbox.executionGet(deps.db, ctx.accountId, id, deps.executionOwned),
  executionBySession: async (ctx, sessionId)  => sandbox.executionBySession(deps.db, ctx.accountId, sessionId, deps.sessionOwned, deps.sandboxCrud),
  executionCreate:    async (_ctx, input)     => mapExecutionCreate(deps, input),
  executionKill:      async (ctx, id)         => sandbox.executionKill(deps.db, ctx.accountId, id, deps.executionOwned, deps.sandboxCrud, deps.sandboxState),
})

function mapExecutionCreate(deps: SandboxAdapterDeps, input: sandbox.ExecutionCreateInput) {
  const r = sandbox.executionCreate(deps.db, deps.config, deps.sandboxCrud, deps.sandboxState, input)
  if (!r.ok) return r
  return { ok: true as const, value: { id: r.value.id } }
}
