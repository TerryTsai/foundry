// Public surface for @foundry/engine.

export { runSession } from './session.js'

export type {
  EngineConfig,
  EngineMcpConfig,
  EngineDeps,
  EngineCrudOps,
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
} from './types.js'
