// In-process adapter for the crud slice. Binds db / providerGet /
// supportedKinds at construction time and converts throwing AppError
// into Result.err on each call.
//
// crud's underlying functions take (db, accountId, …) tuples and
// throw on domain errors; this adapter normalizes them to (ctx, …)
// Result-returning shapes.

import type { Db } from '@foundry/db'
import type { AppError, CrudError } from '@foundry/model'
import * as crud from '@foundry/crud'

import type { CrudSlice } from '../slices/crud.js'
import { wrap } from './wrap.js'

export type CrudAdapterDeps = {
  db:              Db
  providerGet:     crud.ProviderGet
  supportedKinds:  crud.SupportedKindsFn
}

const toCrudError = (e: AppError): CrudError => {
  switch (e.status) {
    case 404: return { kind: 'not_found',         entity: 'unknown', id: '' }
    case 409: return { kind: 'conflict',          reason: e.message }
    case 400: return { kind: 'validation_failed', field: 'unknown', reason: e.message }
    case 401:
    case 403: return { kind: 'permission_denied', reason: e.message }
    default:  return { kind: 'internal',          message: e.message }
  }
}

const w = <T>(fn: () => T | Promise<T>) => wrap<T, CrudError>(fn, toCrudError)

// eslint-disable-next-line max-lines-per-function -- adapter wiring; each line is one method
export const createCrudAdapter = (deps: CrudAdapterDeps): CrudSlice => ({
  // ── projects ──
  projectList:   (ctx, args)         => w(() => crud.projectList(deps.db, ctx.accountId, args)),
  projectGet:    (ctx, id)           => w(() => crud.projectGet(deps.db, ctx.accountId, id)),
  projectCreate: (ctx, args)         => w(() => crud.projectCreate(deps.db, ctx.accountId, args)),
  projectUpdate: (ctx, id, args)     => w(() => crud.projectUpdate(deps.db, ctx.accountId, id, args)),
  projectRun:    (ctx, id)           => w(() => crud.projectRun(deps.db, ctx.accountId, id)),
  projectTagList:(ctx, projectId)    => w(() => crud.projectTagList(deps.db, ctx.accountId, projectId)),

  // ── tickets ──
  ticketList:            (ctx, args)         => w(() => crud.ticketList(deps.db, ctx.accountId, args)),
  ticketGet:             (ctx, id)           => w(() => crud.ticketGet(deps.db, ctx.accountId, id)),
  ticketCreate:          (ctx, args)         => w(() => crud.ticketCreate(deps.db, ctx.accountId, args)),
  ticketUpdate:          (ctx, id, args)     => w(() => crud.ticketUpdate(deps.db, ctx.accountId, id, args)),
  ticketCancel:          (ctx, id)           => w(() => crud.ticketCancel(deps.db, ctx.accountId, id)),
  ticketDependencyChain: (ctx, id)           => w(() => crud.ticketDependencyChain(deps.db, ctx.accountId, id)),
  tagList:               (ctx, ticketId)            => w(() => crud.tagList(deps.db, ctx.accountId, ticketId)),
  tagAdd:                (ctx, ticketId, tag)       => w(() => crud.tagAdd(deps.db, ctx.accountId, ticketId, tag)),
  tagRemove:             (ctx, ticketId, tag)       => w(() => crud.tagRemove(deps.db, ctx.accountId, ticketId, tag)),
  commentList:           (ctx, ticketId)            => w(() => crud.commentList(deps.db, ctx.accountId, ticketId)),
  commentCreate:         (ctx, ticketId, args)      => w(() => crud.commentCreate(deps.db, ctx.accountId, ticketId, args)),
  // VerdictRow is structurally typed identically across crud and the slice.
  verdictList: (ctx, ticketId) => w(() => crud.verdictList(deps.db, ctx.accountId, ticketId)) as ReturnType<CrudSlice['verdictList']>,

  // ── sessions ──
  sessionGet:        (ctx, id)        => w(() => crud.sessionGet(deps.db, ctx.accountId, id)),
  sessionStatus:     (ctx, id)        => w(() => crud.sessionStatus(deps.db, ctx.accountId, id)),
  sessionKill:       (ctx, id)        => w(() => crud.sessionKill(deps.db, ctx.accountId, id)),
  verdictSet:        (ctx, id, args)  => w(() => crud.verdictSet(deps.db, ctx.accountId, id, args)),
  sessionActivities: (ctx, sessionId) => w(() => crud.sessionActivities(deps.db, ctx.accountId, sessionId)),
  sessionByTicket:   (ctx, ticketId)  => w(() => crud.sessionByTicket(deps.db, ctx.accountId, ticketId)),
  sessionListAll:    (ctx)            => w(() => crud.sessionListAll(deps.db, ctx.accountId)),

  // ── agents ──
  agentList:   (ctx, args)         => w(() => crud.agentList(deps.db, { accountId: args.accountId ?? ctx.accountId })),
  agentGet:    (ctx, id)           => w(() => crud.agentGet(deps.db, ctx.accountId, id)),
  agentCreate: (ctx, args)         => w(() => crud.agentCreate(deps.db, ctx.accountId, args)),
  agentUpdate: (ctx, id, args)     => w(() => crud.agentUpdate(deps.db, ctx.accountId, id, args)),
  agentRemove: (ctx, id)           => w(() => crud.agentRemove(deps.db, ctx.accountId, id)),

  // ── connections ──
  connectionList:   (ctx)             => w(() => crud.connectionList(deps.db, ctx.accountId, deps.providerGet)),
  connectionGet:    (ctx, id)         => w(() => crud.connectionGet(deps.db, ctx.accountId, id, deps.providerGet)),
  connectionCreate: (ctx, args)       => w(() => crud.connectionCreate(deps.db, ctx.accountId, args, deps.providerGet, deps.supportedKinds)),
  connectionUpdate: (ctx, id, args)   => w(() => crud.connectionUpdate(deps.db, ctx.accountId, id, args, deps.providerGet)),
  connectionRemove: (ctx, id)         => w(() => crud.connectionRemove(deps.db, ctx.accountId, id)),

  // ── attachments ──
  attachmentCreate:        (ctx, args)        => w(() => crud.attachmentCreate(deps.db, ctx.accountId, args)),
  attachmentListByTicket:  (ctx, ticketId)    => w(() => crud.attachmentListByTicket(deps.db, ctx.accountId, ticketId)),
  attachmentListByComment: (ctx, commentId)   => w(() => crud.attachmentListByComment(deps.db, ctx.accountId, commentId)),
  attachmentGetBytes:      (ctx, id)          => w(() => crud.attachmentGetBytes(deps.db, ctx.accountId, id)),
})
