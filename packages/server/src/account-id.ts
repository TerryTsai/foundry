import type { Request } from 'express'

// Every authenticated request carries req.account (set by requireAuth).
// Helpers pull the account id for handlers that pass it to service
// functions. Throws an Error if called on an unauthenticated request —
// programmer error, since the requireAuth middleware should have rejected
// the request before any handler runs.

export function accountId(req: Request): string {
  if (!req.account) throw new Error('accountId() called without authenticated account')
  return req.account.id
}
