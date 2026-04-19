import type { Request } from 'express'
import { unauthorized } from './errors.js'

// Every authenticated request carries req.account (set by requireAuth from
// either the foundry_session cookie or the sb_ JWT). Helpers below pull
// the account id out for handlers that pass it to service functions.

export function accountId(req: Request): string {
  if (!req.account) throw unauthorized()
  return req.account.id
}
