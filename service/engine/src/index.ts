// Public surface for @foundry/engine.

export { createEngineService } from './service.js'
export type { EngineServiceDeps } from './service.js'
export type { EngineClient, RunSessionArgs } from './client.js'

export type {
  EngineConfig,
  EngineMcpConfig,
  EngineDeps,
  EngineCrudOps,
  EngineError,
  SessionContext,
  LoopResult,
  ToolDef,
  ToolServer,
  IntegrationModule,
  ParsedConn,
  ToolSelection,
  ExecutionCreate,
  ExecutionCreateInput,
  ExecutionHandle,
  ExecHandleEmitter,
  AttachmentSummary,
  VerdictRow,
  McpFoundryCtx,
  McpGithubCtx,
  McpSandboxCtx,
  McpConnCtx,
  McpResult,
} from './schema.js'

// Raw export remains during the @foundry/client → per-service migration.
export { runSession } from './session.js'
