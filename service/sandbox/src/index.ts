// Public surface for @foundry/sandbox.

export { createSandboxService } from './service.js'
export type { SandboxServiceDeps } from './service.js'
export type { SandboxClient, ExecutionCreateResult } from './client.js'

export * as validate from './validate.js'

export type {
  SandboxConfig, SandboxCrudOps, ExecutionMeterCreateInput,
  SandboxState,
  SessionContainerOpts, ContainerStats, ExecHandle, ExecOptions,
  ExecutionCreateInput,
  IsExecutionOwned, IsSessionOwned,
  SandboxError,
} from './schema.js'

// Raw exports remain during the @foundry/client → per-service migration.
export {
  ensureSessionContainer, startSessionContainer,
  stopSessionContainer, stopAllSessionContainers,
  execInContainer,
} from './podman.js'

export {
  executionList, executionGet, executionBySession,
  executionCreate, executionKill, executionStream,
  killRunningExecutionsForTicket,
  registerSessionWorkspace, unregisterSessionWorkspace,
  createSandboxState,
} from './execution.js'
