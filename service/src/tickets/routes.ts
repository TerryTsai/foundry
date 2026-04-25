import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import * as database from '../core/db.js'
import * as validate from './schema.js'
import { ticketOwned } from '../projects/service.js'
import { ticketUsage } from '@foundry/analytics'
import {
  ticketList, ticketGet, ticketCreate, ticketUpdate,
  ticketCancel, ticketDependencyChain,
  commentList, commentCreate, tagList, tagAdd, tagRemove, verdictList,
} from './service.js'
import { sessionByTicket } from '../sessions/service.js'

export function ticketRoutes(db: Db) {
  const r = Router()
  r.get   ('/',            parse(validate.ticketList, 'query'), run(req => ticketList(db, accountId(req), req.data)),                            send())
  r.post  ('/',            parse(validate.ticketCreate),        run(req => ticketCreate(db, accountId(req), req.data)),                          send(201))
  r.get   ('/:id',                                              run(req => ticketGet(db, accountId(req), req.params.id)),                        send())
  r.put   ('/:id',         parse(validate.ticketUpdate),        run(req => ticketUpdate(db, accountId(req), req.params.id, req.data)),           send())
  r.post  ('/:id/cancel',                                        run(req => ticketCancel(db, accountId(req), req.params.id)),                     send())
  r.get   ('/:id/chain',                                        run(req => ticketDependencyChain(db, accountId(req), req.params.id)),            send())
  r.get   ('/:id/verdict',                                      run(req => verdictList(db, accountId(req), req.params.id)),                      send())
  r.get   ('/:id/comment',                                      run(req => commentList(db, accountId(req), req.params.id)),                      send())
  r.post  ('/:id/comment', parse(validate.commentCreate),       run(req => commentCreate(db, accountId(req), req.params.id, req.data)),          send(201))
  r.get   ('/:id/session',                                      run(req => sessionByTicket(db, accountId(req), req.params.id)),                  send())
  r.get   ('/:id/event',                                        run(req => { ticketOwned(db, req.params.id, accountId(req)); return database.eventByEntity(db, 'ticket', req.params.id) }), send())
  r.get   ('/:id/usage',                                        run(req => { ticketOwned(db, req.params.id, accountId(req)); return ticketUsage(db, req.params.id) }),                      send())
  r.get   ('/:id/tag',                                          run(req => tagList(db, accountId(req), req.params.id)),                           send())
  r.post  ('/:id/tag',              parse(validate.tagCreate),  run(req => tagAdd(db, accountId(req), req.params.id, req.data.tag)),              send(201))
  r.delete('/:id/tag/:tag',                                     run(req => tagRemove(db, accountId(req), req.params.id, req.params.tag)),         send())
  return r
}
