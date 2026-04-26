// Public surface for @foundry/model. Bottom of the dependency graph —
// nothing in here imports from any other workspace package. See
// ARCHITECTURE.md for promotion rules.

export { ok, err, unwrap } from './result.js'
export type { Result } from './result.js'

export { makeCtx } from './ctx.js'
export type { Ctx } from './ctx.js'

export type {
  Ulid, Timestamp,
  AccountId, ProjectId, TicketId, SessionId, AgentId,
} from './primitives.js'

export type {
  Account, AuthSession,
  Project,
  Connection,
  Ticket, TicketStatus,
  Comment,
  Attachment,
  Agent,
  Session, SessionStatus,
  Activity, ActivityKind,
  Execution, ExecutionStatus,
  Event,
} from './entities/index.js'

export type {
  AuthError,
  BillingError,
  CrudError,
  AnalyticsError,
  SandboxError,
  McpError,
  EngineError,
  ReconcilerError,
} from './errors/index.js'

export {
  pick, now, timestamps, toInt, succeeds,
} from './util.js'
