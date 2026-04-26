// Public surface for @foundry/crud. Re-exports from per-entity files.

export { createCrudService } from './service.js'
export type { CrudServiceDeps } from './service.js'
export type { CrudClient } from './client.js'

export * as validate from './validate.js'

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

// secrets-crypto — raw functions; server binds the key in closures.
export {
  encryptSecret, decryptSecret, isEncrypted,
} from './secrets-crypto.js'

// attachment
export {
  attachmentCreate, attachmentListByTicket, attachmentListByComment,
  attachmentGetBytes, attachmentListByTicketInternal, attachmentGetInternal,
} from './attachment.js'

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

// event log
export {
  eventCreate, eventByEntity, eventLatest,
} from './event.js'

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

// Shape exports — types/interfaces consumed by callers (routes, server,
// adapters). All declared in schema.ts per the schema.ts standard.
export type {
  AttachmentMeta, AttachmentBytes, AttachmentCreateInput,
  ExecutionInsertInput, ActivityCreateInput,
  DependencyChainEntry, VerdictRow,
  EventCreateInput,
  EncryptSecret, DecryptSecret, CryptoOps,
  MaskedConnection,
  ConnectionProviderField, ConnectionProviderSpec,
  ProviderGet, SupportedKindsFn,
  CrudError,
} from './schema.js'
