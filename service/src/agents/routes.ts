import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import {
  validate,
  agentList, agentGet, agentCreate, agentUpdate, agentRemove,
  sessionGet, sessionStatus, sessionKill, sessionActivities,
} from '@foundry/crud'
import { agentMcpList, TOOL_NAMES } from '@foundry/mcp'
import { agentUsage } from '@foundry/analytics'

export function agentRoutes(db: Db) {
  const r = Router()
  r.get   ('/tools',                              run(()  => [...TOOL_NAMES]),                                                              send())
  r.get   ('/mcp',                                run(req => agentMcpList(db, accountId(req))),                                             send())
  r.get   ('/',           parse(validate.agent.list, 'query'), run(req => agentList(db, { accountId: accountId(req) })),                    send())
  r.post  ('/',           parse(validate.agent.create),        run(req => agentCreate(db, accountId(req), req.data)),                       send(201))
  r.get   ('/:id',                                run(req => agentGet(db, accountId(req), req.params.id)),                                  send())
  r.get   ('/:id/usage',                          run(req => { agentGet(db, accountId(req), req.params.id); return agentUsage(db, req.params.id) }), send())
  r.put   ('/:id',        parse(validate.agent.update),        run(req => agentUpdate(db, accountId(req), req.params.id, req.data)),        send())
  r.delete('/:id',                                run(req => agentRemove(db, accountId(req), req.params.id)),                               send())
  r.get   ('/:id/session/:sid',                   run(req => sessionGet(db, accountId(req), req.params.sid)),                               send())
  r.get   ('/:id/session/:sid/status',            run(req => sessionStatus(db, accountId(req), req.params.sid)),                            send())
  r.delete('/:id/session/:sid',                   run(req => sessionKill(db, accountId(req), req.params.sid)),                              send())
  r.get   ('/:id/session/:sid/activity',          run(req => sessionActivities(db, accountId(req), req.params.sid)),                        send())
  return r
}
