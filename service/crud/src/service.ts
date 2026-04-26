// Wiring for @foundry/crud. createCrudService binds db + provider/crypto
// callbacks once and returns a CrudClient backed by the pure functions
// in this module. Owns no runtime state.

import type { Db } from '@foundry/db'

import * as project from './project.js'
import * as ticket from './ticket.js'
import * as session from './session.js'
import * as agent from './agent.js'
import * as connection from './connection.js'
import * as attachment from './attachment.js'
import type {
  EncryptSecret, DecryptSecret, ProviderGet, SupportedKindsFn,
} from './schema.js'
import type { CrudClient } from './client.js'

export type CrudServiceDeps = {
  db:              Db
  providerGet:     ProviderGet
  supportedKinds:  SupportedKindsFn
  encryptSecret:   EncryptSecret
  decryptSecret:   DecryptSecret
}

// eslint-disable-next-line max-lines-per-function -- service wiring; one line per client method
export const createCrudService = (deps: CrudServiceDeps): CrudClient => ({
  // ── projects ──
  projectList:    async (ctx, args)         => project.projectList(deps.db, ctx.accountId, args),
  projectGet:     async (ctx, id)           => project.projectGet(deps.db, ctx.accountId, id),
  projectCreate:  async (ctx, args)         => project.projectCreate(deps.db, ctx.accountId, args),
  projectUpdate:  async (ctx, id, args)     => project.projectUpdate(deps.db, ctx.accountId, id, args),
  projectRun:     async (ctx, id)           => project.projectRun(deps.db, ctx.accountId, id),
  projectTagList: async (ctx, projectId)    => project.projectTagList(deps.db, ctx.accountId, projectId),

  // ── tickets ──
  ticketList:            async (ctx, args)         => ticket.ticketList(deps.db, ctx.accountId, args),
  ticketGet:             async (ctx, id)           => ticket.ticketGet(deps.db, ctx.accountId, id),
  ticketCreate:          async (ctx, args)         => ticket.ticketCreate(deps.db, ctx.accountId, args),
  ticketUpdate:          async (ctx, id, args)     => ticket.ticketUpdate(deps.db, ctx.accountId, id, args),
  ticketCancel:          async (ctx, id)           => ticket.ticketCancel(deps.db, ctx.accountId, id),
  ticketDependencyChain: async (ctx, id)           => ticket.ticketDependencyChain(deps.db, ctx.accountId, id),
  tagList:               async (ctx, ticketId)            => ticket.tagList(deps.db, ctx.accountId, ticketId),
  tagAdd:                async (ctx, ticketId, tag)       => ticket.tagAdd(deps.db, ctx.accountId, ticketId, tag),
  tagRemove:             async (ctx, ticketId, tag)       => ticket.tagRemove(deps.db, ctx.accountId, ticketId, tag),
  commentList:           async (ctx, ticketId)            => ticket.commentList(deps.db, ctx.accountId, ticketId),
  commentCreate:         async (ctx, ticketId, args)      => ticket.commentCreate(deps.db, ctx.accountId, ticketId, args),
  verdictList:           async (ctx, ticketId)            => ticket.verdictList(deps.db, ctx.accountId, ticketId),

  // ── sessions ──
  sessionGet:        async (ctx, id)        => session.sessionGet(deps.db, ctx.accountId, id),
  sessionStatus:     async (ctx, id)        => session.sessionStatus(deps.db, ctx.accountId, id),
  sessionKill:       async (ctx, id)        => session.sessionKill(deps.db, ctx.accountId, id),
  verdictSet:        async (ctx, id, args)  => session.verdictSet(deps.db, ctx.accountId, id, args),
  sessionActivities: async (ctx, sessionId) => session.sessionActivities(deps.db, ctx.accountId, sessionId),
  sessionByTicket:   async (ctx, ticketId)  => session.sessionByTicket(deps.db, ctx.accountId, ticketId),
  sessionListAll:    async (ctx)            => session.sessionListAll(deps.db, ctx.accountId),

  // ── agents ──
  agentList:   async (ctx, args)         => agent.agentList(deps.db, { accountId: args.accountId ?? ctx.accountId }),
  agentGet:    async (ctx, id)           => agent.agentGet(deps.db, ctx.accountId, id),
  agentCreate: async (ctx, args)         => agent.agentCreate(deps.db, ctx.accountId, args),
  agentUpdate: async (ctx, id, args)     => agent.agentUpdate(deps.db, ctx.accountId, id, args),
  agentRemove: async (ctx, id)           => agent.agentRemove(deps.db, ctx.accountId, id),

  // ── connections ──
  connectionList:   async (ctx)             => connection.connectionList(deps.db, ctx.accountId, deps.providerGet, deps.decryptSecret),
  connectionGet:    async (ctx, id)         => connection.connectionGet(deps.db, ctx.accountId, id, deps.providerGet, deps.decryptSecret),
  connectionCreate: async (ctx, args)       => connection.connectionCreate(deps.db, ctx.accountId, args, deps.providerGet, deps.supportedKinds, deps.encryptSecret, deps.decryptSecret),
  connectionUpdate: async (ctx, id, args)   => connection.connectionUpdate(deps.db, ctx.accountId, id, args, deps.providerGet, deps.encryptSecret, deps.decryptSecret),
  connectionRemove: async (ctx, id)         => connection.connectionRemove(deps.db, ctx.accountId, id),

  // ── attachments ──
  attachmentCreate:        async (ctx, args)        => attachment.attachmentCreate(deps.db, ctx.accountId, args),
  attachmentListByTicket:  async (ctx, ticketId)    => attachment.attachmentListByTicket(deps.db, ctx.accountId, ticketId),
  attachmentListByComment: async (ctx, commentId)   => attachment.attachmentListByComment(deps.db, ctx.accountId, commentId),
  attachmentGetBytes:      async (ctx, id)          => attachment.attachmentGetBytes(deps.db, ctx.accountId, id),
})
