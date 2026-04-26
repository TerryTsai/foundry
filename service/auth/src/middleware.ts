import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Db, Account } from '@foundry/db'
import type { AuthConfig, AuthCrudOps, CookieOpts } from './schema.js'
import * as sessionJwt from './session-jwt.js'

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

export function serializeCookie(name: string, value: string, opts: CookieOpts): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`]
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  if (opts.secure) parts.push('Secure')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  return parts.join('; ')
}

// ── Auth middleware ──
// Two credentials accepted: foundry_session cookie OR Authorization
// Bearer sb_<jwt>. The bearer path is for sandbox tools; the cookie
// path is for real users via GitHub OAuth.

export function requireAuth(db: Db, _config: AuthConfig, crud: AuthCrudOps, key: Buffer): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const account = resolveAccount(db, crud, req, key)
    if (!account) return res.status(401).json({ error: 'unauthorized' })
    req.account = account
    next()
  }
}

function resolveAccount(db: Db, crud: AuthCrudOps, req: Request, key: Buffer): Account | null {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) return resolveBearer(db, crud, authHeader.slice(7), key)
  return resolveCookie(db, crud, req.headers.cookie)
}

function resolveBearer(db: Db, crud: AuthCrudOps, token: string, key: Buffer): Account | null {
  if (!token.startsWith('sb_')) return null
  const claims = sessionJwt.verify(token, key)
  if (!claims) return null
  return crud.accountGet(db, claims.aid) ?? null
}

function resolveCookie(db: Db, crud: AuthCrudOps, cookieHeader: string | undefined): Account | null {
  const sid = parseCookie(cookieHeader, 'foundry_session')
  if (!sid) return null
  const session = crud.authSessionGet(db, sid)
  if (!session || new Date(session.expires_at) < new Date()) return null
  return crud.accountGet(db, session.account_id) ?? null
}
