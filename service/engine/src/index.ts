// Public surface for @foundry/engine.

export { createEngineService } from './service.js'
export type { EngineServiceDeps } from './service.js'
export type { EngineClient, RunSessionArgs } from './client.js'

export type {
  EngineConfig,
  EngineDeps,
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

// Raw export remains during the @foundry/client → per-service migration.
export { runSession } from './session.js'
