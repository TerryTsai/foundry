import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import { providerGet as mcpProviderGet, providerList, providerMetadata, supportedKinds } from '@foundry/mcp'
import {
  validate,
  connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove,
  type ProviderGet,
} from '@foundry/crud'

// Bridge mcp.providerGet (typed against its local ConnectionProvider
// interface) to the structurally-compatible ProviderGet alias the crud module
// expects. The crud module declares its own minimal provider shape so it
// doesn't have to import from mcp.
const providerGet: ProviderGet = (kind: string) => mcpProviderGet(kind)

export function connectionRoutes(db: Db) {
  const r = Router()
  // Provider metadata — drives UI form rendering and connection creation.
  // Lists every supported kind, its credential schema, and declared tool
  // names. No secrets, no handlers, safe to serve.
  r.get   ('/providers', run(() => providerList().map(providerMetadata)), send())
  r.get   ('/',    parse(validate.connection.list, 'query'), run(req => connectionList(db, accountId(req), providerGet)),                              send())
  r.get   ('/:id',                                            run(req => connectionGet(db, accountId(req), req.params.id, providerGet)),                send())
  r.post  ('/',    parse(validate.connection.create),         run(req => connectionCreate(db, accountId(req), req.data, providerGet, supportedKinds)), send(201))
  r.put   ('/:id', parse(validate.connection.update),         run(req => connectionUpdate(db, accountId(req), req.params.id, req.data, providerGet)),  send())
  r.delete('/:id',                                            run(req => connectionRemove(db, accountId(req), req.params.id)),                          send())
  return r
}
