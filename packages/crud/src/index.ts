// Public surface for @foundry/crud. Re-exports from per-entity files.

export * as validate from './validators.js'

// project
export {
  projectGetOwned, assertProjectOwner, ticketOwned, sessionOwned, executionOwned,
  projectList, projectGet, projectCreate, projectUpdate, projectRun, projectTagList,
} from './project.js'

// ticket
export {
  ticketList, ticketGet, ticketCreate, ticketUpdate, ticketCancel,
  ticketDependencyChain, ticketPriorHistory,
  commentList, commentCreate,
  verdictList,
  tagList, tagAdd, tagRemove,
} from './ticket.js'
export type { DependencyChainEntry } from './ticket.js'

// session
export {
  sessionGet, sessionStatus, verdictSet, sessionKill,
  sessionActivities, activityCreate, sessionByTicket, sessionListAll,
} from './session.js'

// agent
export {
  agentList, agentGet, agentCreate, agentUpdate, agentRemove,
} from './agent.js'

// connection
export {
  connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove,
} from './connection.js'
export type {
  MaskedConnection, ConnectionProviderField, ConnectionProviderSpec,
  ProviderGet, SupportedKindsFn,
} from './connection.js'

// secrets-crypto
export {
  encryptSecret, decryptSecret, isEncrypted, assertKeyConfigured,
} from './secrets-crypto.js'

// attachment
export {
  attachmentCreate, attachmentListByTicket, attachmentListByComment,
  attachmentGetBytes, attachmentListByTicketInternal, attachmentGetInternal,
} from './attachment.js'
export type { AttachmentMeta } from './attachment.js'

// execution metering — DB-side writes for the sandbox runtime
export {
  executionList,
  executionGet as executionGetById,
  executionBySession,
  executionCreate as executionMeterCreate,
  executionUpdate as executionMeterUpdate,
  executionMarkCancelled,
  sessionsForTicketRaw,
} from './execution.js'
export type { ExecutionInsertInput } from './execution.js'

// event log
export {
  eventCreate, eventByEntity, eventLatest,
} from './event.js'
export type { EventCreateInput } from './event.js'

// internal cross-module callbacks (engine / reconciler / sandbox / auth / mcp)
export {
  ticketGetById, ticketTransition, ticketUpdateById, ticketAllByProject,
  projectGetById, projectsActive,
  sessionGetById, sessionUpdateById, sessionInsert,
  sessionRunning, sessionRunningForTicket, sessionsByTicketRaw,
  activityCreate as activityWrite,
  activityUpdate, activityByTurnOrder,
  agentGetById,
  connectionGetById, connectionByAccount, connectionUpdateById,
  accountGetById,
  verdictBySession, verdictByTicket,
  authSessionGet, authSessionInsert, authSessionRemove,
  accountUpsertByGithubId, claimUnownedProjects,
  commentByTicket,
} from './internal.js'

// verdict row type (formerly @foundry/db's VerdictRow)
export type { VerdictRow } from './repo.js'
