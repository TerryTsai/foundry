import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ZodType } from 'zod'
import { AppError, badRequest } from './functional.js'
import type { Account } from './schema.js'
import * as database from './database.js'
import type { Db } from './database.js'
import type { Config } from './config.js'

declare global {
  namespace Express {
    interface Request {
      data?: any
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
//   2. `Authorization: Bearer <config.internalApiToken>` — sandbox-hosted
//      tool calls (foundry introspection, integrations) that curl back
//      into the service from inside a podman container. Presenting the
//      token authenticates the request but does NOT populate req.account,
//      so any handler that calls accountId(req) still 401s — only the
//      project-scoped tool endpoints (ticket list/get/create, agent list,
//      etc.) work without an owner identity.

export const requireAuth = (db: Db, config: Config): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    // Internal bearer token — sandbox tools curling back into the service.
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === config.internalApiToken) {
      return next()
    }
    // Session cookie — real user.
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (!sid) return next(new AppError(401, 'unauthorized'))
    const session = database.authSessionGet(db, sid)
    if (!session || new Date(session.expires_at) < new Date()) return next(new AppError(401, 'unauthorized'))
    const account = database.accountGet(db, session.account_id)
    if (!account) return next(new AppError(401, 'unauthorized'))
    req.account = account
    next()
  }

// ── Validation ──

export const parse = <T>(schema: ZodType<T>, from: 'body' | 'query' = 'body'): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[from])
    if (!result.success) throw badRequest(JSON.stringify(result.error.issues))
    req.data = result.data
    next()
  }

// ── Handler Wrapper ──

export const run = (fn: (req: Request) => unknown): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req)
      if (result instanceof Promise) {
        result.then(data => { res.locals.result = data; next() }).catch(next)
      } else {
        res.locals.result = result
        next()
      }
    } catch (err) {
      next(err)
    }
  }

// ── Response ──

export const send = (status = 200): RequestHandler =>
  (_req: Request, res: Response) => {
    res.status(status).json(res.locals.result)
  }

export const sendText: RequestHandler =
  (_req: Request, res: Response) => {
    res.type('text/plain').send(res.locals.result)
  }

// ── Error Handler ──

export const errors: ErrorRequestHandler =
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message })
    } else {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'internal error'
      res.status(500).json({ error: msg })
    }
  }
