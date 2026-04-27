// Public surface for @foundry/sandbox.

export { createSandboxService } from './service.js'
export type { SandboxClient, ExecutionCreateResult } from './client.js'

export * as validate from './validate.js'

export type {
  SandboxConfig, ExecutionMeterCreateInput,
  SandboxState,
  SessionContainerOpts, ContainerStats, ExecHandle, ExecOptions,
  ExecutionCreateInput,
  SandboxError,
} from './schema.js'

// Raw exports remain during the @foundry/client → per-service migration.
export {
  ensureSessionContainer, startSessionContainer,
  stopSessionContainer, stopAllSessionContainers,
  execInContainer,
} from './podman.js'

export {
  executionCreate,
  executionStream,
  killRunningExecutionsForTicket,
  registerSessionWorkspace, unregisterSessionWorkspace,
  createSandboxState,
} from './execution.js'
