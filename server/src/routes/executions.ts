import { Router } from 'express'
import type { Request, Response } from 'express'
import { makeCtx } from '@foundry/model'
import { parse, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import {
  validate,
  executionStream,
  type SandboxState,
} from '@foundry/sandbox'
import type { SandboxClient } from '@foundry/sandbox'

export function executionRoutes(sandbox: SandboxClient, sandboxState: SandboxState) {
  const r = Router()
  r.get   ('/',           runResult(req => sandbox.executionList(makeCtx({ accountId: accountId(req) }))),                                  send())
  r.post  ('/',           parse(validate.executionCreate), runResult(req => sandbox.executionCreate(makeCtx({ accountId: accountId(req) }), data(validate.executionCreate, req))), send(201))
  r.get   ('/:id',        runResult(req => sandbox.executionGet(makeCtx({ accountId: accountId(req) }), req.params.id)),                    send())
  r.delete('/:id',        runResult(req => sandbox.executionKill(makeCtx({ accountId: accountId(req) }), req.params.id)),                   send())
  r.get   ('/:id/output', (req: Request, res: Response) => streamExecution(sandboxState, req, res))
  return r
}

function streamExecution(sandboxState: SandboxState, req: Request, res: Response): void {
  const r = executionStream(req.params.id, res, sandboxState)
  if (!r.ok) {
    if (!res.headersSent) res.status(404).json({ error: r.error.kind })
  }
}
