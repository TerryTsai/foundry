import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { unauthorized } from '@foundry/model'
import type { Db, Account } from '@foundry/db'
import type { AuthConfig, AuthCrudOps } from './types.js'
import * as sessionJwt from './session-jwt.js'

// Express request augmentation: requireAuth attaches the resolved Account to
// req.account so downstream handlers can read it directly. Declared here
// (the module that owns the middleware) so consumers don't need their own
// ambient declaration.
declare global {
  namespace Express {
    interface Request {
      account?: Account
    }
  }
}

// ── Cookies ──
// Tiny parser/serializer; one cookie helper is cheaper than a dependency.

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export function serializeCookie(name: string, value: string, opts: {
  maxAge?:  number    // seconds; 0 deletes
  secure?:  boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  path?:    string
  httpOnly?: boolean
}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${opts.path ?? '/'}`)
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  if (opts.secure) parts.push('Secure')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  return parts.join('; ')
}

// ── Auth ──
// Two credentials accepted:
//   1. `foundry_session` cookie — real users via GitHub OAuth.
//   2. `Authorization: Bearer sb_…` — per-session sandbox JWT. Signature
//      carries session/ticket/project/account so subsequent handlers see
//      req.account exactly like a normal cookie request. Sandbox tools
//      cannot read or modify resources outside their own session's
//      project. The legacy global INTERNAL_API_TOKEN path is no longer
//      accepted; bearer requests must present a live sandbox JWT.

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export const requireAuth = (db: Db, _config: AuthConfig, crud: AuthCrudOps): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      // Per-session sandbox JWT. Claims carry the resolved
      // session/ticket/project/account chain — verifying the HMAC is the
      // whole identity check, no DB lookup required. accountGet hydrates
      // the full Account row for handlers that read more than `id`.
      if (token.startsWith('sb_')) {
        const claims = sessionJwt.verify(token)
        if (!claims) return next(unauthorized())
        const account = crud.accountGet(db, claims.aid)
        if (!account) return next(unauthorized())
        req.account = account
        return next()
      }
      return next(unauthorized())
    }
    // Session cookie — real user.
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (!sid) return next(unauthorized())
    const session = crud.authSessionGet(db, sid)
    if (!session || new Date(session.expires_at) < new Date()) return next(unauthorized())
    const account = crud.accountGet(db, session.account_id)
    if (!account) return next(unauthorized())
    req.account = account
    next()
  }
