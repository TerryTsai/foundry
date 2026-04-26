import { Router } from 'express'
import type { Db } from '@foundry/db'
import { parse, run, runResult, send, data } from '../http.js'
import { accountId } from '../account-id.js'
import { providerGet as mcpProviderGet, providerList, providerMetadata, supportedKinds } from '@foundry/mcp'
import {
  validate,
  connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove,
  type ProviderGet, type EncryptSecret, type DecryptSecret,
} from '@foundry/crud'

const providerGet: ProviderGet = (kind: string) => mcpProviderGet(kind)

export function connectionRoutes(db: Db, encryptSecret: EncryptSecret, decryptSecret: DecryptSecret) {
  const r = Router()
  r.get   ('/providers', run(() => providerList().map(providerMetadata)), send())
  r.get   ('/',    parse(validate.connection.list, 'query'), runResult(req => connectionList(db, accountId(req), providerGet, decryptSecret)),                              send())
  r.get   ('/:id',                                            runResult(req => connectionGet(db, accountId(req), req.params.id, providerGet, decryptSecret)),                send())
  r.post  ('/',    parse(validate.connection.create),         runResult(req => connectionCreate(db, accountId(req), data(validate.connection.create, req), providerGet, supportedKinds, encryptSecret, decryptSecret)), send(201))
  r.put   ('/:id', parse(validate.connection.update),         runResult(req => connectionUpdate(db, accountId(req), req.params.id, data(validate.connection.update, req), providerGet, encryptSecret, decryptSecret)),  send())
  r.delete('/:id',                                            runResult(req => connectionRemove(db, accountId(req), req.params.id)),                          send())
  return r
}
