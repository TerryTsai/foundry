// Wiring for @foundry/sandbox. createSandboxService binds db + config +
// the CrudClient + SandboxState (running execs, session containers,
// workspaces) and returns a SandboxClient.
//
// The SandboxState is the runtime piece: a small set of Maps that survive
// across tool calls. server allocates one at boot via createSandboxState()
// and passes it in here.

import type { Db } from '@foundry/db'
import type { Execution } from '@foundry/db'
import type { Result, Ctx } from '@foundry/model'
import { ok, err } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'

import {
  executionList, executionBySession, executionCreate, executionKill,
} from './execution.js'
import type {
  ExecutionCreateInput,
  SandboxConfig, SandboxState, SandboxError,
} from './schema.js'
import type { SandboxClient, ExecutionCreateResult } from './client.js'

export const createSandboxService = (
  _db: Db, config: SandboxConfig, crud: CrudClient, state: SandboxState,
): SandboxClient => ({
  executionList:      async (ctx)             => executionList(ctx, crud),
  executionGet:       async (ctx, id)         => mapGet(ctx, crud, id),
  executionBySession: async (ctx, sessionId)  => executionBySession(ctx, crud, sessionId),
  executionCreate:    async (_ctx, input)     => mapCreate(config, crud, state, input),
  executionKill:      async (ctx, id)         => executionKill(ctx, crud, id, state),
})

function mapCreate(
  config: SandboxConfig, crud: CrudClient, state: SandboxState, input: ExecutionCreateInput,
): Result<ExecutionCreateResult, SandboxError> {
  const r = executionCreate(config, crud, state, input)
  if (!r.ok) return r
  return { ok: true as const, value: { id: r.value.id } }
}

async function mapGet(
  ctx: Ctx, crud: CrudClient, id: string,
): Promise<Result<Execution, SandboxError>> {
  const r = await crud.executionList(ctx)
  if (!r.ok) return err({ kind: 'internal', message: r.error.kind })
  const row = r.value.find((e: Execution) => e.id === id)
  if (!row) return err({ kind: 'not_found', id })
  return ok(row)
}
