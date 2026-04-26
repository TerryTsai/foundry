// Cross-module surface for @foundry/sandbox. Exposes the metering
// (Execution) entity to HTTP routes. Per-session container lifecycle
// (ensureSessionContainer / startSessionContainer / stopSessionContainer)
// stays internal — only the engine + composition root drive it.
//
// executionStream is intentionally NOT on the client surface: it writes
// directly to an Express Response (transport-bound). HTTP routes call
// the underlying function via the in-process module reference, not
// through the typed client.

import type { Ctx, Result, SandboxError } from '@foundry/model'
import type { Execution } from '@foundry/db'

export type ExecutionCreateInput = {
  command:     string
  session_id?: string
  tool_name?:  string
  tool_input?: unknown
  tool_use_id?: string
  timeout_ms?: number
  env?:        Record<string, string>
}

export type ExecutionCreateResult = { id: string }

export type SandboxSlice = {
  executionList:      (ctx: Ctx)                                    => Promise<Result<Execution[], SandboxError>>
  executionGet:       (ctx: Ctx, id: string)                        => Promise<Result<Execution, SandboxError>>
  executionBySession: (ctx: Ctx, sessionId: string)                 => Promise<Result<Execution[], SandboxError>>
  executionCreate:    (ctx: Ctx, input: ExecutionCreateInput)       => Promise<Result<ExecutionCreateResult, SandboxError>>
  executionKill:      (ctx: Ctx, id: string)                        => Promise<Result<{ ok: true }, SandboxError>>
}
