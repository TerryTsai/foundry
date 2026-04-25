import { Router } from 'express'
import type { Db } from '@foundry/db'
import { parse, run, send } from '../http.js'
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
import { killRunningExecutionsForTicket, type SandboxCrudOps } from '@foundry/sandbox'

export function ticketRoutes(db: Db, sandboxCrud: SandboxCrudOps) {
  const r = Router()
  r.get   ('/',            parse(validate.ticket.list, 'query'), run(req => ticketList(db, accountId(req), req.data)),                            send())
  r.post  ('/',            parse(validate.ticket.create),        run(req => ticketCreate(db, accountId(req), req.data)),                          send(201))
  r.get   ('/:id',                                               run(req => ticketGet(db, accountId(req), req.params.id)),                        send())
  r.put   ('/:id',         parse(validate.ticket.update),        run(req => ticketUpdate(db, accountId(req), req.params.id, req.data)),           send())
  // ticketCancel used to kill running sandbox executions inline; that's a
  // cross-module call (executions → sandbox), so it now happens in the
  // route handler after the cancel succeeds.
  r.post  ('/:id/cancel',                                        run(req => {
    const ticket = ticketCancel(db, accountId(req), req.params.id)
    killRunningExecutionsForTicket(db, req.params.id, sandboxCrud)
    return ticket
  }),                     send())
  r.get   ('/:id/chain',                                         run(req => ticketDependencyChain(db, accountId(req), req.params.id)),            send())
  r.get   ('/:id/verdict',                                       run(req => verdictList(db, accountId(req), req.params.id)),                      send())
  r.get   ('/:id/comment',                                       run(req => commentList(db, accountId(req), req.params.id)),                      send())
  r.post  ('/:id/comment', parse(validate.ticket.commentCreate), run(req => commentCreate(db, accountId(req), req.params.id, req.data)),          send(201))
  r.get   ('/:id/session',                                       run(req => sessionByTicket(db, accountId(req), req.params.id)),                  send())
  r.get   ('/:id/event',                                         run(req => { ticketOwned(db, req.params.id, accountId(req)); return eventByEntity(db, 'ticket', req.params.id) }), send())
  r.get   ('/:id/usage',                                         run(req => { ticketOwned(db, req.params.id, accountId(req)); return ticketUsage(db, req.params.id) }),                      send())
  r.get   ('/:id/tag',                                           run(req => tagList(db, accountId(req), req.params.id)),                          send())
  r.post  ('/:id/tag',              parse(validate.ticket.tagCreate), run(req => tagAdd(db, accountId(req), req.params.id, req.data.tag)),         send(201))
  r.delete('/:id/tag/:tag',                                      run(req => tagRemove(db, accountId(req), req.params.id, req.params.tag)),        send())
  return r
}
