import { Router } from 'express'
import type { Request, Response } from 'express'
import type { Db } from '@foundry/db'
import type { Result, SandboxError } from '@foundry/model'
import type { Config } from '../config.js'
import { parse, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  executionList, executionGet, executionCreate, executionKill, executionStream,
  type SandboxCrudOps,
} from '@foundry/sandbox'
import { executionOwned } from '@foundry/crud'

export function executionRoutes(db: Db, config: Config, sandboxCrud: SandboxCrudOps) {
  const r = Router()
  r.get   ('/',           runResult(req => executionList(db, accountId(req), sandboxCrud)),                                                                  send())
  r.post  ('/',           parse(validate.executionCreate), runResult(req => createExecution(db, config, sandboxCrud, req)),                                  send(201))
  r.get   ('/:id',        runResult(req => executionGet(db, accountId(req), req.params.id, executionOwned)),                                                 send())
  r.delete('/:id',        runResult(req => executionKill(db, accountId(req), req.params.id, executionOwned, sandboxCrud)),                                   send())
  r.get   ('/:id/output', (req: Request, res: Response) => streamExecution(db, req, res))
  return r
}

function createExecution(db: Db, config: Config, sandboxCrud: SandboxCrudOps, req: Request): Result<{ id: string }, SandboxError> {
  const r = executionCreate(db, config, sandboxCrud, data(validate.executionCreate, req))
  if (!r.ok) return r
  return { ok: true, value: { id: r.value.id } }
}

function streamExecution(db: Db, req: Request, res: Response): void {
  const r = executionStream(db, accountId(req), req.params.id, res, executionOwned)
  if (!r.ok) {
    if (!res.headersSent) res.status(404).json({ error: r.error.kind })
  }
}
