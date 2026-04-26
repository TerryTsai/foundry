// Wiring for @foundry/sandbox. createSandboxService binds db + config +
// crud callbacks + ownership-check callbacks + the SandboxState (running
// execs, session containers, workspaces) and returns a SandboxClient.
//
// The SandboxState is the runtime piece: a small set of Maps that survive
// across tool calls. server allocates one at boot via createSandboxState()
// and passes it in here.

import type { Db } from '@foundry/db'
import type { Result } from '@foundry/model'

import {
  executionList, executionGet, executionBySession, executionCreate, executionKill,
} from './execution.js'
import type {
  ExecutionCreateInput, IsExecutionOwned, IsSessionOwned,
  SandboxConfig, SandboxCrudOps, SandboxState, SandboxError,
} from './schema.js'
import type { SandboxClient, ExecutionCreateResult } from './client.js'

export type SandboxServiceDeps = {
  db:             Db
  config:         SandboxConfig
  executionOwned: IsExecutionOwned
  sessionOwned:   IsSessionOwned
  sandboxCrud:    SandboxCrudOps
  sandboxState:   SandboxState
}

export const createSandboxService = (deps: SandboxServiceDeps): SandboxClient => ({
  executionList:      async (ctx)             => executionList(deps.db, ctx.accountId, deps.sandboxCrud),
  executionGet:       async (ctx, id)         => executionGet(deps.db, ctx.accountId, id, deps.executionOwned),
  executionBySession: async (ctx, sessionId)  => executionBySession(deps.db, ctx.accountId, sessionId, deps.sessionOwned, deps.sandboxCrud),
  executionCreate:    async (_ctx, input)     => mapCreate(deps, input),
  executionKill:      async (ctx, id)         => executionKill(deps.db, ctx.accountId, id, deps.executionOwned, deps.sandboxCrud, deps.sandboxState),
})

function mapCreate(deps: SandboxServiceDeps, input: ExecutionCreateInput): Result<ExecutionCreateResult, SandboxError> {
  const r = executionCreate(deps.db, deps.config, deps.sandboxCrud, deps.sandboxState, input)
  if (!r.ok) return r
  return { ok: true as const, value: { id: r.value.id } }
}
