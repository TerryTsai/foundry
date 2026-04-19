import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import * as validate from './schema.js'
import { projectList, projectGet, projectCreate, projectUpdate, projectRun, projectTagList } from './service.js'

export function projectRoutes(db: Db) {
  const r = Router()
  r.get   ('/',         parse(validate.projectList, 'query'), run(req => projectList(db, accountId(req), req.data)),                       send())
  r.post  ('/',         parse(validate.projectCreate),        run(req => projectCreate(db, accountId(req), req.data)),                     send(201))
  r.get   ('/:id',                                            run(req => projectGet(db, accountId(req), req.params.id)),                   send())
  r.put   ('/:id',      parse(validate.projectUpdate),        run(req => projectUpdate(db, accountId(req), req.params.id, req.data)),      send())
  r.get   ('/:id/tags',                                       run(req => projectTagList(db, accountId(req), req.params.id)),               send())
  r.post  ('/:id/run',                                        run(req => projectRun(db, accountId(req), req.params.id)),                   send(202))
  return r
}
