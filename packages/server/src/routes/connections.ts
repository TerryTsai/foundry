import { Router } from 'express'
import type { Db } from '@foundry/db'
import { parse, run, runResult, send } from '../http.js'
import { accountId } from '../account-id.js'
import { providerGet as mcpProviderGet, providerList, providerMetadata, supportedKinds } from '@foundry/mcp'
import {
  validate,
  connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove,
  type ProviderGet,
} from '@foundry/crud'

const providerGet: ProviderGet = (kind: string) => mcpProviderGet(kind)

export function connectionRoutes(db: Db) {
  const r = Router()
  r.get   ('/providers', run(() => providerList().map(providerMetadata)), send())
  r.get   ('/',    parse(validate.connection.list, 'query'), runResult(req => connectionList(db, accountId(req), providerGet)),                              send())
  r.get   ('/:id',                                            runResult(req => connectionGet(db, accountId(req), req.params.id, providerGet)),                send())
  r.post  ('/',    parse(validate.connection.create),         runResult(req => connectionCreate(db, accountId(req), req.data, providerGet, supportedKinds)), send(201))
  r.put   ('/:id', parse(validate.connection.update),         runResult(req => connectionUpdate(db, accountId(req), req.params.id, req.data, providerGet)),  send())
  r.delete('/:id',                                            runResult(req => connectionRemove(db, accountId(req), req.params.id)),                          send())
  return r
}
