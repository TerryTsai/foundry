import { Router } from 'express'
import type { Db } from '@foundry/db'
import type { Config } from '../config.js'
import { parse, run, send } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  executionList, executionGet, executionCreate, executionKill, executionStream,
  type SandboxCrudOps,
} from '@foundry/sandbox'
import { executionOwned } from '@foundry/crud'

export function executionRoutes(db: Db, config: Config, sandboxCrud: SandboxCrudOps) {
  const r = Router()
  r.get   ('/',           run(req => executionList(db, accountId(req), sandboxCrud)),                                                                  send())
  r.post  ('/',           parse(validate.executionCreate), run(req => { const { id } = executionCreate(db, config, sandboxCrud, req.data); return { id } }),                     send(201))
  r.get   ('/:id',        run(req => executionGet(db, accountId(req), req.params.id, executionOwned)),                                                              send())
  r.delete('/:id',        run(req => executionKill(db, accountId(req), req.params.id, executionOwned, sandboxCrud)),                                                             send())
  r.get   ('/:id/output', (req, res, next) => { try { executionStream(db, accountId(req), req.params.id, res, executionOwned) } catch (e) { next(e) } })
  return r
}
