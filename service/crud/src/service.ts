// Wiring for @foundry/crud. createCrudService binds db + provider helpers
// + encryption key once and returns a CrudClient backed by the pure
// functions in this module. Owns no runtime state.

import type { Db } from '@foundry/db'
import { ok, err } from '@foundry/model'
import type { Result } from '@foundry/model'

import * as project from './project.js'
import * as ticket from './ticket.js'
import * as session from './session.js'
import * as agent from './agent.js'
import * as connection from './connection.js'
import * as attachment from './attachment.js'
import * as execution from './execution.js'
import * as event from './event.js'
import * as internal from './internal.js'
import type { ConnectionProviderSpec, CrudError } from './schema.js'
import type { CrudClient } from './client.js'

// Internal helpers in @foundry/crud are sync (db calls). Wrap each one
// in async + Result so the CrudClient surface is uniformly
// async/Result/Ctx-shaped — matching the contract every consumer
// (engine, reconciler, sandbox, auth, routes) reads against.
async function asAsync<T>(thunk: () => T): Promise<Result<T, CrudError>> {
  try { return ok(thunk()) }
  catch (e) { return err({ kind: 'internal', message: e instanceof Error ? e.message : String(e) }) }
}

// eslint-disable-next-line max-lines-per-function -- service wiring; one line per client method
export const createCrudService = (
  db: Db,
  providerGet: (kind: string) => ConnectionProviderSpec | undefined,
  supportedKinds: () => string[],
  encryptionKey: Buffer,
): CrudClient => ({
  // ── projects (owned) ──
  projectList:    async (ctx, args)         => project.projectList(db, ctx.accountId, args),
  projectGet:     async (ctx, id)           => project.projectGet(db, ctx.accountId, id),
  projectCreate:  async (ctx, args)         => project.projectCreate(db, ctx.accountId, args),
  projectUpdate:  async (ctx, id, args)     => project.projectUpdate(db, ctx.accountId, id, args),
  projectRun:     async (ctx, id)           => project.projectRun(db, ctx.accountId, id),
  projectTagList: async (ctx, projectId)    => project.projectTagList(db, ctx.accountId, projectId),

  // ── tickets (owned) ──
  ticketList:            async (ctx, args)         => ticket.ticketList(db, ctx.accountId, args),
  ticketGet:             async (ctx, id)           => ticket.ticketGet(db, ctx.accountId, id),
  ticketCreate:          async (ctx, args)         => ticket.ticketCreate(db, ctx.accountId, args),
  ticketUpdate:          async (ctx, id, args)     => ticket.ticketUpdate(db, ctx.accountId, id, args),
  ticketCancel:          async (ctx, id)           => ticket.ticketCancel(db, ctx.accountId, id),
  ticketDependencyChain: async (ctx, id)           => ticket.ticketDependencyChain(db, ctx.accountId, id),
  tagList:               async (ctx, ticketId)            => ticket.tagList(db, ctx.accountId, ticketId),
  tagAdd:                async (ctx, ticketId, tag)       => ticket.tagAdd(db, ctx.accountId, ticketId, tag),
  tagRemove:             async (ctx, ticketId, tag)       => ticket.tagRemove(db, ctx.accountId, ticketId, tag),
  commentList:           async (ctx, ticketId)            => ticket.commentList(db, ctx.accountId, ticketId),
  commentCreate:         async (ctx, ticketId, args)      => ticket.commentCreate(db, ctx.accountId, ticketId, args),
  verdictList:           async (ctx, ticketId)            => ticket.verdictList(db, ctx.accountId, ticketId),

  // ── sessions (owned) ──
  sessionGet:        async (ctx, id)        => session.sessionGet(db, ctx.accountId, id),
  sessionStatus:     async (ctx, id)        => session.sessionStatus(db, ctx.accountId, id),
  sessionKill:       async (ctx, id)        => session.sessionKill(db, ctx.accountId, id),
  verdictSet:        async (ctx, id, args)  => session.verdictSet(db, ctx.accountId, id, args),
  sessionActivities: async (ctx, sessionId) => session.sessionActivities(db, ctx.accountId, sessionId),
  sessionByTicket:   async (ctx, ticketId)  => session.sessionByTicket(db, ctx.accountId, ticketId),
  sessionListAll:    async (ctx)            => session.sessionListAll(db, ctx.accountId),

  // ── agents (owned) ──
  agentList:   async (ctx, args)         => agent.agentList(db, { accountId: args.accountId ?? ctx.accountId }),
  agentGet:    async (ctx, id)           => agent.agentGet(db, ctx.accountId, id),
  agentCreate: async (ctx, args)         => agent.agentCreate(db, ctx.accountId, args),
  agentUpdate: async (ctx, id, args)     => agent.agentUpdate(db, ctx.accountId, id, args),
  agentRemove: async (ctx, id)           => agent.agentRemove(db, ctx.accountId, id),

  // ── connections (owned) ──
  connectionList:   async (ctx)             => connection.connectionList(db, ctx.accountId, providerGet, encryptionKey),
  connectionGet:    async (ctx, id)         => connection.connectionGet(db, ctx.accountId, id, providerGet, encryptionKey),
  connectionCreate: async (ctx, args)       => connection.connectionCreate(db, ctx.accountId, args, providerGet, supportedKinds, encryptionKey),
  connectionUpdate: async (ctx, id, args)   => connection.connectionUpdate(db, ctx.accountId, id, args, providerGet, encryptionKey),
  connectionRemove: async (ctx, id)         => connection.connectionRemove(db, ctx.accountId, id),

  // ── attachments (owned) ──
  attachmentCreate:        async (ctx, args)        => attachment.attachmentCreate(db, ctx.accountId, args),
  attachmentListByTicket:  async (ctx, ticketId)    => attachment.attachmentListByTicket(db, ctx.accountId, ticketId),
  attachmentListByComment: async (ctx, commentId)   => attachment.attachmentListByComment(db, ctx.accountId, commentId),
  attachmentGetBytes:      async (ctx, id)          => attachment.attachmentGetBytes(db, ctx.accountId, id),

  // ── internal: entity reads (no ownership) ──
  ticketGetById:        (_ctx, id)               => asAsync(() => internal.ticketGetById(db, id)),
  ticketAllByProject:   (_ctx, projectId, status) => asAsync(() => internal.ticketAllByProject(db, projectId, status)),
  projectGetById:       (_ctx, id)               => asAsync(() => internal.projectGetById(db, id)),
  projectsActive:       (_ctx)                   => asAsync(() => internal.projectsActive(db)),
  sessionGetById:       (_ctx, id)               => asAsync(() => internal.sessionGetById(db, id)),
  sessionRunning:       (_ctx)                   => asAsync(() => internal.sessionRunning(db)),
  sessionRunningForTicket: (_ctx, ticketId)      => asAsync(() => internal.sessionRunningForTicket(db, ticketId)),
  sessionsByTicketRaw:  (_ctx, ticketId)         => asAsync(() => internal.sessionsByTicketRaw(db, ticketId)),
  agentGetById:         (_ctx, id)               => asAsync(() => internal.agentGetById(db, id)),
  agentListInternal:    async (_ctx, accountId)  => agent.agentList(db, { accountId }),
  connectionGetById:    (_ctx, id)               => asAsync(() => internal.connectionGetById(db, id)),
  connectionByAccount:  (_ctx, accountId)        => asAsync(() => internal.connectionByAccount(db, accountId)),
  accountGetById:       (_ctx, id)               => asAsync(() => internal.accountGetById(db, id)),
  commentByTicket:      (_ctx, ticketId)         => asAsync(() => internal.commentByTicket(db, ticketId)),
  verdictBySession:     (_ctx, sessionId)        => asAsync(() => internal.verdictBySession(db, sessionId)),
  verdictByTicket:      (_ctx, ticketId)         => asAsync(() => internal.verdictByTicket(db, ticketId)),
  activityByTurnOrder:  (_ctx, sId, tId, idx)    => asAsync(() => internal.activityByTurnOrder(db, sId, tId, idx)),
  attachmentListByTicketInternal: (_ctx, ticketId) => asAsync(() => attachment.attachmentListByTicketInternal(db, ticketId)),

  // ── internal: entity writes (no ownership) ──
  ticketTransition:     (_ctx, id, from, to)     => asAsync(() => internal.ticketTransition(db, id, from, to)),
  ticketUpdateById:     (_ctx, id, data)         => asAsync(() => internal.ticketUpdateById(db, id, data)),
  sessionUpdateById:    (_ctx, id, data)         => asAsync(() => internal.sessionUpdateById(db, id, data)),
  sessionInsert:        (_ctx, data)             => asAsync(() => internal.sessionInsert(db, data)),
  connectionUpdateById: (_ctx, id, data)         => asAsync(() => internal.connectionUpdateById(db, id, data)),
  activityCreate:       (_ctx, data)             => asAsync(() => internal.activityCreate(db, data)),
  activityUpdate:       (_ctx, id, data)         => asAsync(() => internal.activityUpdate(db, id, data)),
  accountUpsertByGithubId: (_ctx, args)          => asAsync(() => internal.accountUpsertByGithubId(db, args)),
  claimUnownedProjects: (_ctx, ownerLogin)       => asAsync(() => internal.claimUnownedProjects(db, ownerLogin)),

  // ── auth-session storage ──
  authSessionGet:    (_ctx, id)    => asAsync(() => internal.authSessionGet(db, id)),
  authSessionInsert: (_ctx, args)  => asAsync(() => internal.authSessionInsert(db, args)),
  authSessionRemove: (_ctx, id)    => asAsync(() => { internal.authSessionRemove(db, id) }),

  // ── event log ──
  eventCreate: (_ctx, data) => asAsync(() => event.eventCreate(db, data)),
  eventLatest: (_ctx, et, eid) => asAsync(() => event.eventLatest(db, et, eid)),

  // ── execution metering ──
  executionList:          async (ctx)       => ok(execution.executionList(db, ctx.accountId)),
  executionBySession:     (_ctx, sessionId) => asAsync(() => execution.executionBySession(db, sessionId)),
  executionMeterCreate:   (_ctx, data)      => asAsync(() => execution.executionCreate(db, data)),
  executionMeterUpdate:   (_ctx, id, data)  => asAsync(() => execution.executionUpdate(db, id, data)),
  executionMarkCancelled: (_ctx, id)        => asAsync(() => { execution.executionMarkCancelled(db, id) }),
})
