import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Account } from '@foundry/db'
import { makeCtx } from '@foundry/model'
import type { Ctx } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'
import type { CookieOpts } from './schema.js'
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

export function requireAuth(crud: CrudClient, key: Buffer): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const account = await resolveAccount(crud, req, key)
    if (!account) return res.status(401).json({ error: 'unauthorized' })
    req.account = account
    next()
  }
}

async function resolveAccount(crud: CrudClient, req: Request, key: Buffer): Promise<Account | null> {
  const ctx = makeCtx({ accountId: 'system' })
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) return resolveBearer(ctx, crud, authHeader.slice(7), key)
  return resolveCookie(ctx, crud, req.headers.cookie)
}

async function resolveBearer(ctx: Ctx, crud: CrudClient, token: string, key: Buffer): Promise<Account | null> {
  if (!token.startsWith('sb_')) return null
  const claims = sessionJwt.verify(token, key)
  if (!claims) return null
  const r = await crud.accountGetById(ctx, claims.aid)
  return r.ok ? (r.value ?? null) : null
}

async function resolveCookie(ctx: Ctx, crud: CrudClient, cookieHeader: string | undefined): Promise<Account | null> {
  const sid = parseCookie(cookieHeader, 'foundry_session')
  if (!sid) return null
  const sR = await crud.authSessionGet(ctx, sid)
  if (!sR.ok || !sR.value || new Date(sR.value.expires_at) < new Date()) return null
  const aR = await crud.accountGetById(ctx, sR.value.account_id)
  return aR.ok ? (aR.value ?? null) : null
}
