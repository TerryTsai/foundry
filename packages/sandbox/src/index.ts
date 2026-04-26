// Public surface for @foundry/sandbox.

export * as validate from './validators.js'

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

export type {
  SandboxConfig, SandboxCrudOps, ExecutionMeterCreateInput,
  SandboxState,
  SessionContainerOpts, ContainerStats, ExecHandle, ExecOptions,
  ExecutionCreateInput, ExecutionCreateResult,
  IsExecutionOwned, IsSessionOwned,
} from './schema.js'
