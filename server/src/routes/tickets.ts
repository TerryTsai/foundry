import { Router } from 'express'
import type { Request } from 'express'
import type { Db, Event } from '@foundry/db'
import type { Result, CrudError, AnalyticsError } from '@foundry/model'
import { ok } from '@foundry/model'
import { parse, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  ticketList, ticketGet, ticketCreate, ticketUpdate,
  ticketCancel, ticketDependencyChain,
  commentList, commentCreate, tagList, tagAdd, tagRemove, verdictList,
  ticketOwned,
  sessionByTicket,
  eventByEntity,
} from '@foundry/crud'
import { ticketUsage } from '@foundry/analytics'
import { killRunningExecutionsForTicket, type SandboxCrudOps, type SandboxState } from '@foundry/sandbox'

export function ticketRoutes(db: Db, sandboxCrud: SandboxCrudOps, sandboxState: SandboxState) {
  const r = Router()
  r.get   ('/',            parse(validate.ticket.list, 'query'), runResult(req => ticketList(db, accountId(req), data(validate.ticket.list, req))),                            send())
  r.post  ('/',            parse(validate.ticket.create),        runResult(req => ticketCreate(db, accountId(req), data(validate.ticket.create, req))),                       send(201))
  r.get   ('/:id',                                               runResult(req => ticketGet(db, accountId(req), req.params.id)),                                                send())
  r.put   ('/:id',         parse(validate.ticket.update),        runResult(req => ticketUpdate(db, accountId(req), req.params.id, data(validate.ticket.update, req))),         send())
  r.post  ('/:id/cancel',                                        runResult(req => cancelAndKill(db, sandboxCrud, sandboxState, req)),                                            send())
  r.get   ('/:id/chain',                                         runResult(req => ticketDependencyChain(db, accountId(req), req.params.id)),                                    send())
  r.get   ('/:id/verdict',                                       runResult(req => verdictList(db, accountId(req), req.params.id)),                                              send())
  r.get   ('/:id/comment',                                       runResult(req => commentList(db, accountId(req), req.params.id)),                                              send())
  r.post  ('/:id/comment', parse(validate.ticket.commentCreate), runResult(req => commentCreate(db, accountId(req), req.params.id, data(validate.ticket.commentCreate, req))), send(201))
  r.get   ('/:id/session',                                       runResult(req => sessionByTicket(db, accountId(req), req.params.id)),                                          send())
  r.get   ('/:id/event',                                         runResult(req => ticketEvents(db, req)),                                                                        send())
  r.get   ('/:id/usage',                                         runResult(req => ticketUsageScoped(db, req)),                                                                   send())
  r.get   ('/:id/tag',                                           runResult(req => tagList(db, accountId(req), req.params.id)),                                                  send())
  r.post  ('/:id/tag',     parse(validate.ticket.tagCreate),     runResult(req => tagAdd(db, accountId(req), req.params.id, data(validate.ticket.tagCreate, req).tag)),         send(201))
  r.delete('/:id/tag/:tag',                                      runResult(req => tagRemove(db, accountId(req), req.params.id, req.params.tag)),        send())
  return r
}

function cancelAndKill(db: Db, sandboxCrud: SandboxCrudOps, sandboxState: SandboxState, req: Request): Result<unknown, CrudError> {
  const r = ticketCancel(db, accountId(req), req.params.id)
  if (!r.ok) return r
  killRunningExecutionsForTicket(db, req.params.id, sandboxCrud, sandboxState)
  return ok(r.value)
}

function ticketEvents(db: Db, req: Request): Result<Event[], CrudError> {
  const owned = ticketOwned(db, req.params.id, accountId(req))
  if (!owned.ok) return owned
  return ok(eventByEntity(db, 'ticket', req.params.id))
}

function ticketUsageScoped(db: Db, req: Request): Result<unknown, CrudError | AnalyticsError> {
  const owned = ticketOwned(db, req.params.id, accountId(req))
  if (!owned.ok) return owned
  return ticketUsage(db, req.params.id)
}
