import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import { sessionGet, sessionActivities, sessionListAll, verdictSet } from './service.js'
import { sessionOwned } from '../projects/service.js'
import { executionBySession } from '../executions/service.js'
import { sessionUsage } from '@foundry/analytics'
import * as validate from './schema.js'

export function sessionRoutes(db: Db) {
  const r = Router()
  r.get ('/',               run(req => sessionListAll(db, accountId(req))),                       send())
  r.get ('/:id',            run(req => sessionGet(db, accountId(req), req.params.id)),            send())
  r.get ('/:id/activity',   run(req => sessionActivities(db, accountId(req), req.params.id)),     send())
  r.get ('/:id/execution',  run(req => executionBySession(db, accountId(req), req.params.id)),    send())
  r.get ('/:id/usage',      run(req => { sessionOwned(db, req.params.id, accountId(req)); return sessionUsage(db, req.params.id) }), send())
  r.post('/:id/verdict',    parse(validate.verdictSet), run(req => verdictSet(db, accountId(req), req.params.id, req.data)), send())
  return r
}
