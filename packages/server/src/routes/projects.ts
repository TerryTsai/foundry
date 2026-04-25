import { Router } from 'express'
import type { Db } from '@foundry/db'
import { parse, run, send } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  projectList, projectGet, projectCreate, projectUpdate, projectRun, projectTagList,
} from '@foundry/crud'
import { reconcilerTick, reconcilerDepsActive } from '@foundry/reconciler'

export function projectRoutes(db: Db) {
  const r = Router()
  r.get   ('/',         parse(validate.project.list, 'query'), run(req => projectList(db, accountId(req), req.data)),                       send())
  r.post  ('/',         parse(validate.project.create),        run(req => projectCreate(db, accountId(req), req.data)),                     send(201))
  r.get   ('/:id',                                             run(req => projectGet(db, accountId(req), req.params.id)),                   send())
  r.put   ('/:id',      parse(validate.project.update),        run(req => projectUpdate(db, accountId(req), req.params.id, req.data)),      send())
  r.get   ('/:id/tags',                                        run(req => projectTagList(db, accountId(req), req.params.id)),               send())
  // projectRun used to trigger reconcilerTick from inside the service. The
  // crud module is now reconciler-agnostic, so the route handler invokes
  // the tick directly after a successful run.
  r.post  ('/:id/run',                                         run(req => {
    const result = projectRun(db, accountId(req), req.params.id)
    const deps = reconcilerDepsActive()
    if (deps) reconcilerTick(db, deps).catch((err: unknown) => console.error('reconciler error:', err))
    return result
  }), send(202))
  return r
}
