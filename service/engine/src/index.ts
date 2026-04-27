// Public surface for @foundry/engine.

export { createEngineService } from './service.js'
export type { EngineClient, RunSessionArgs } from './client.js'

export type {
  EngineConfig,
  EngineError,
  SessionContext,
  LoopResult,
  ExecutionCreate,
  ExecutionCreateInput,
  ExecutionHandle,
  ExecHandleEmitter,
  AttachmentSummary,
  McpFoundryCtx,
  McpGithubCtx,
  McpSandboxCtx,
  McpConnCtx,
} from './schema.js'
