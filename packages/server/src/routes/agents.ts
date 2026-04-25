import { Router } from 'express'
import type { Request } from 'express'
import type { Db } from '@foundry/db'
import type { Result, CrudError, AnalyticsError } from '@foundry/model'
import { ok } from '@foundry/model'
import { parse, run, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  agentList, agentGet, agentCreate, agentUpdate, agentRemove,
  sessionGet, sessionStatus, sessionKill, sessionActivities,
  connectionByAccount,
} from '@foundry/crud'
import { agentMcpList, TOOL_NAMES } from '@foundry/mcp'
import { agentUsage } from '@foundry/analytics'

export function agentRoutes(db: Db) {
  const r = Router()
  r.get   ('/tools',                              run(()  => [...TOOL_NAMES]),                                                              send())
  r.get   ('/mcp',                                run(req => agentMcpList(db, accountId(req), connectionByAccount)),                        send())
  r.get   ('/',           parse(validate.agent.list, 'query'), runResult(req => agentList(db, { accountId: accountId(req) })),               send())
  r.post  ('/',           parse(validate.agent.create),        runResult(req => agentCreate(db, accountId(req), data(validate.agent.create, req))), send(201))
  r.get   ('/:id',                                runResult(req => agentGet(db, accountId(req), req.params.id)),                             send())
  r.get   ('/:id/usage',                          runResult(req => agentUsageScoped(db, req)),                                               send())
  r.put   ('/:id',        parse(validate.agent.update),        runResult(req => agentUpdate(db, accountId(req), req.params.id, data(validate.agent.update, req))), send())
  r.delete('/:id',                                runResult(req => agentRemove(db, accountId(req), req.params.id)),                          send())
  r.get   ('/:id/session/:sid',                   runResult(req => sessionGet(db, accountId(req), req.params.sid)),                          send())
  r.get   ('/:id/session/:sid/status',            runResult(req => sessionStatus(db, accountId(req), req.params.sid)),                       send())
  r.delete('/:id/session/:sid',                   runResult(req => sessionKill(db, accountId(req), req.params.sid)),                         send())
  r.get   ('/:id/session/:sid/activity',          runResult(req => sessionActivities(db, accountId(req), req.params.sid)),                   send())
  return r
}

function agentUsageScoped(db: Db, req: Request): Result<unknown, CrudError | AnalyticsError> {
  const owned = agentGet(db, accountId(req), req.params.id)
  if (!owned.ok) return owned
  return agentUsage(db, req.params.id)
}

void ok
