// Cross-service contract for @foundry/sandbox. Exposes the metering
// (Execution) entity to HTTP routes. Per-session container lifecycle
// (ensureSessionContainer / startSessionContainer / stopSessionContainer)
// stays internal — only the engine + composition root drive it.
//
// executionStream is intentionally NOT on this surface: it writes
// directly to an Express Response (transport-bound). HTTP routes call
// the underlying function via the in-process module reference.

import type { Ctx, Result } from '@foundry/model'
import type { Execution } from '@foundry/db'

import type { ExecutionCreateInput, SandboxError } from './schema.js'

export type ExecutionCreateResult = { id: string }

export type SandboxClient = {
  executionList:      (ctx: Ctx)                                    => Promise<Result<Execution[], SandboxError>>
  executionGet:       (ctx: Ctx, id: string)                        => Promise<Result<Execution, SandboxError>>
  executionBySession: (ctx: Ctx, sessionId: string)                 => Promise<Result<Execution[], SandboxError>>
  executionCreate:    (ctx: Ctx, input: ExecutionCreateInput)       => Promise<Result<ExecutionCreateResult, SandboxError>>
  executionKill:      (ctx: Ctx, id: string)                        => Promise<Result<{ ok: true }, SandboxError>>
}
