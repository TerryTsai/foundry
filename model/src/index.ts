// Public surface for @foundry/model. Bottom of the dependency graph —
// nothing in here imports from any other workspace package. See
// ARCHITECTURE.md for promotion rules.

export { ok, err, unwrap } from './result.js'
export type { Result } from './result.js'

export { makeCtx } from './ctx.js'
export type { Ctx } from './ctx.js'

export { bind } from './bind.js'
export type { Bound } from './bind.js'

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

// Per-service error unions live in each service's schema.ts and are
// re-exported by its index.ts. Cross-service consumers import them via
// `import type { XxxError } from '@foundry/<service>'` (type-only —
// cardinal rule still forbids value imports of peer logic modules).

export {
  pick, now, timestamps, toInt, succeeds,
} from './util.js'
