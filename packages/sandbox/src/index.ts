// Public surface for @foundry/sandbox.

export * as validate from './validators.js'

export type { SandboxConfig, SandboxCrudOps, ExecutionMeterCreateInput } from './types.js'

export {
  ensureSessionContainer, startSessionContainer,
  stopSessionContainer, stopAllSessionContainers,
  execInContainer,
} from './podman.js'
export type {
  SessionContainerOpts, ContainerStats, ExecHandle, ExecOptions,
} from './podman.js'

export {
  executionList, executionGet, executionBySession,
  executionCreate, executionKill, executionStream,
  killRunningExecutionsForTicket,
  registerSessionWorkspace, unregisterSessionWorkspace,
} from './execution.js'
export type {
  ExecutionCreateInput, ExecutionCreateResult,
  IsExecutionOwned, IsSessionOwned,
} from './execution.js'
