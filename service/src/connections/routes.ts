import { Router } from 'express'
import type { Db } from '../core/db.js'
import { parse, run, send } from '../core/http.js'
import { accountId } from '../core/account-id.js'
import * as validate from './schema.js'
import * as providers from '../integrations/registry.js'
import { connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove } from './service.js'

export function connectionRoutes(db: Db) {
  const r = Router()
  // Provider metadata — drives UI form rendering and connection creation.
  // Lists every supported kind, its credential schema, and declared tool
  // names. No secrets, no handlers, safe to serve.
  r.get   ('/providers', run(() => providers.providerList().map(providers.providerMetadata)), send())
  r.get   ('/',    parse(validate.connectionList, 'query'), run(req => connectionList(db, accountId(req))),                              send())
  r.get   ('/:id',                                          run(req => connectionGet(db, accountId(req), req.params.id)),                send())
  r.post  ('/',    parse(validate.connectionCreate),        run(req => connectionCreate(db, accountId(req), req.data)),                  send(201))
  r.put   ('/:id', parse(validate.connectionUpdate),        run(req => connectionUpdate(db, accountId(req), req.params.id, req.data)),   send())
  r.delete('/:id',                                          run(req => connectionRemove(db, accountId(req), req.params.id)),             send())
  return r
}
