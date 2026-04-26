import { Router } from 'express'
import type { Request } from 'express'
import type { Db } from '@foundry/db'
import type { Result } from '@foundry/model'
import { parse, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  sessionGet, sessionActivities, sessionListAll, verdictSet,
  sessionOwned,
  type CrudError,
} from '@foundry/crud'
import { executionBySession, type SandboxCrudOps, type SandboxError } from '@foundry/sandbox'
import { sessionUsage, type AnalyticsError } from '@foundry/analytics'

export function sessionRoutes(db: Db, sandboxCrud: SandboxCrudOps) {
  const r = Router()
  r.get ('/',               runResult(req => sessionListAll(db, accountId(req))),                       send())
  r.get ('/:id',            runResult(req => sessionGet(db, accountId(req), req.params.id)),            send())
  r.get ('/:id/activity',   runResult(req => sessionActivities(db, accountId(req), req.params.id)),     send())
  r.get ('/:id/execution',  runResult(req => execsForSession(db, sandboxCrud, req)),                    send())
  r.get ('/:id/usage',      runResult(req => sessionUsageScoped(db, req)),                              send())
  r.post('/:id/verdict',    parse(validate.session.verdictSet), runResult(req => verdictSet(db, accountId(req), req.params.id, data(validate.session.verdictSet, req))), send())
  return r
}

function execsForSession(db: Db, sandboxCrud: SandboxCrudOps, req: Request): Result<unknown, SandboxError> {
  return executionBySession(db, accountId(req), req.params.id, sessionOwned, sandboxCrud)
}

function sessionUsageScoped(db: Db, req: Request): Result<unknown, CrudError | AnalyticsError> {
  const owned = sessionOwned(db, req.params.id, accountId(req))
  if (!owned.ok) return owned
  return sessionUsage(db, req.params.id)
}
