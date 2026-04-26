// In-process adapter for the crud slice. Crud functions natively return
// Result; this adapter is a pass-through that binds db / providerGet /
// supportedKinds and forwards (ctx, …) tuples to (db, accountId, …).

import type { Db } from '@foundry/db'
import * as crud from '@foundry/crud'

import type { CrudSlice } from '../slices/crud.js'

export type CrudAdapterDeps = {
  db:              Db
  providerGet:     crud.ProviderGet
  supportedKinds:  crud.SupportedKindsFn
  encryptSecret:   crud.EncryptSecret
  decryptSecret:   crud.DecryptSecret
}

// eslint-disable-next-line max-lines-per-function -- adapter wiring; one line per slice method
export const createCrudAdapter = (deps: CrudAdapterDeps): CrudSlice => ({
  // ── projects ──
  projectList:    async (ctx, args)         => crud.projectList(deps.db, ctx.accountId, args),
  projectGet:     async (ctx, id)           => crud.projectGet(deps.db, ctx.accountId, id),
  projectCreate:  async (ctx, args)         => crud.projectCreate(deps.db, ctx.accountId, args),
  projectUpdate:  async (ctx, id, args)     => crud.projectUpdate(deps.db, ctx.accountId, id, args),
  projectRun:     async (ctx, id)           => crud.projectRun(deps.db, ctx.accountId, id),
  projectTagList: async (ctx, projectId)    => crud.projectTagList(deps.db, ctx.accountId, projectId),

  // ── tickets ──
  ticketList:            async (ctx, args)         => crud.ticketList(deps.db, ctx.accountId, args),
  ticketGet:             async (ctx, id)           => crud.ticketGet(deps.db, ctx.accountId, id),
  ticketCreate:          async (ctx, args)         => crud.ticketCreate(deps.db, ctx.accountId, args),
  ticketUpdate:          async (ctx, id, args)     => crud.ticketUpdate(deps.db, ctx.accountId, id, args),
  ticketCancel:          async (ctx, id)           => crud.ticketCancel(deps.db, ctx.accountId, id),
  ticketDependencyChain: async (ctx, id)           => crud.ticketDependencyChain(deps.db, ctx.accountId, id),
  tagList:               async (ctx, ticketId)            => crud.tagList(deps.db, ctx.accountId, ticketId),
  tagAdd:                async (ctx, ticketId, tag)       => crud.tagAdd(deps.db, ctx.accountId, ticketId, tag),
  tagRemove:             async (ctx, ticketId, tag)       => crud.tagRemove(deps.db, ctx.accountId, ticketId, tag),
  commentList:           async (ctx, ticketId)            => crud.commentList(deps.db, ctx.accountId, ticketId),
  commentCreate:         async (ctx, ticketId, args)      => crud.commentCreate(deps.db, ctx.accountId, ticketId, args),
  verdictList:           async (ctx, ticketId)            => crud.verdictList(deps.db, ctx.accountId, ticketId) as Awaited<ReturnType<CrudSlice['verdictList']>>,

  // ── sessions ──
  sessionGet:        async (ctx, id)        => crud.sessionGet(deps.db, ctx.accountId, id),
  sessionStatus:     async (ctx, id)        => crud.sessionStatus(deps.db, ctx.accountId, id),
  sessionKill:       async (ctx, id)        => crud.sessionKill(deps.db, ctx.accountId, id),
  verdictSet:        async (ctx, id, args)  => crud.verdictSet(deps.db, ctx.accountId, id, args),
  sessionActivities: async (ctx, sessionId) => crud.sessionActivities(deps.db, ctx.accountId, sessionId),
  sessionByTicket:   async (ctx, ticketId)  => crud.sessionByTicket(deps.db, ctx.accountId, ticketId),
  sessionListAll:    async (ctx)            => crud.sessionListAll(deps.db, ctx.accountId),

  // ── agents ──
  agentList:   async (ctx, args)         => crud.agentList(deps.db, { accountId: args.accountId ?? ctx.accountId }),
  agentGet:    async (ctx, id)           => crud.agentGet(deps.db, ctx.accountId, id),
  agentCreate: async (ctx, args)         => crud.agentCreate(deps.db, ctx.accountId, args),
  agentUpdate: async (ctx, id, args)     => crud.agentUpdate(deps.db, ctx.accountId, id, args),
  agentRemove: async (ctx, id)           => crud.agentRemove(deps.db, ctx.accountId, id),

  // ── connections ──
  connectionList:   async (ctx)             => crud.connectionList(deps.db, ctx.accountId, deps.providerGet, deps.decryptSecret),
  connectionGet:    async (ctx, id)         => crud.connectionGet(deps.db, ctx.accountId, id, deps.providerGet, deps.decryptSecret),
  connectionCreate: async (ctx, args)       => crud.connectionCreate(deps.db, ctx.accountId, args, deps.providerGet, deps.supportedKinds, deps.encryptSecret, deps.decryptSecret),
  connectionUpdate: async (ctx, id, args)   => crud.connectionUpdate(deps.db, ctx.accountId, id, args, deps.providerGet, deps.encryptSecret, deps.decryptSecret),
  connectionRemove: async (ctx, id)         => crud.connectionRemove(deps.db, ctx.accountId, id),

  // ── attachments ──
  attachmentCreate:        async (ctx, args)        => crud.attachmentCreate(deps.db, ctx.accountId, args),
  attachmentListByTicket:  async (ctx, ticketId)    => crud.attachmentListByTicket(deps.db, ctx.accountId, ticketId),
  attachmentListByComment: async (ctx, commentId)   => crud.attachmentListByComment(deps.db, ctx.accountId, commentId),
  attachmentGetBytes:      async (ctx, id)          => crud.attachmentGetBytes(deps.db, ctx.accountId, id),
})
