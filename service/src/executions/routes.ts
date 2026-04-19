import { Router } from 'express'
import type { Db } from '../core/db.js'
import type { Config } from '../core/config.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import * as validate from './schema.js'
import { executionList, executionGet, executionCreate, executionKill, executionStream } from './service.js'

export function executionRoutes(db: Db, config: Config) {
  const r = Router()
  r.get   ('/',           run(req => executionList(db, accountId(req))),                                                                                  send())
  r.post  ('/',           parse(validate.executionCreate), run(req => { const { id } = executionCreate(db, config, req.data); return { id } }),           send(201))
  r.get   ('/:id',        run(req => executionGet(db, accountId(req), req.params.id)),                                                                    send())
  r.delete('/:id',        run(req => executionKill(db, accountId(req), req.params.id)),                                                                   send())
  r.get   ('/:id/output', (req, res, next) => { try { executionStream(db, accountId(req), req.params.id, res) } catch (e) { next(e) } })
  return r
}
