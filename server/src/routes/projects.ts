import { Router } from 'express'
import type { Request } from 'express'
import type { Db } from '@foundry/db'
import { ok } from '@foundry/model'
import { parse, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  projectList, projectGet, projectCreate, projectUpdate, projectRun, projectTagList,
} from '@foundry/crud'

export function projectRoutes(db: Db, triggerReconcile: () => void) {
  const r = Router()
  r.get   ('/',         parse(validate.project.list, 'query'), runResult(req => projectList(db, accountId(req), data(validate.project.list, req))),                       send())
  r.post  ('/',         parse(validate.project.create),        runResult(req => projectCreate(db, accountId(req), data(validate.project.create, req))),                   send(201))
  r.get   ('/:id',                                             runResult(req => projectGet(db, accountId(req), req.params.id)),                                            send())
  r.put   ('/:id',      parse(validate.project.update),        runResult(req => projectUpdate(db, accountId(req), req.params.id, data(validate.project.update, req))),    send())
  r.get   ('/:id/tags',                                        runResult(req => projectTagList(db, accountId(req), req.params.id)),               send())
  r.post  ('/:id/run',                                         runResult(req => runProject(db, req, triggerReconcile)), send(202))
  return r
}

function runProject(db: Db, req: Request, triggerReconcile: () => void) {
  const result = projectRun(db, accountId(req), req.params.id)
  if (!result.ok) return result
  triggerReconcile()
  return ok(result.value)
}
