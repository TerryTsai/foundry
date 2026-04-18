import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ZodType } from 'zod'
import { appError, badRequest, isAppError, unauthorized } from './errors.js'
import * as sandboxToken from './domain/sandboxToken.js'
import type { Account } from './tables.js'
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
//   2. `Authorization: Bearer sb_…` — per-session sandbox token. Resolves
//      session → ticket → project → owner so subsequent handlers see
//      req.account exactly like a normal cookie request. Sandbox tools
//      cannot read or modify resources outside their own session's
//      project. The legacy global INTERNAL_API_TOKEN path is no longer
//      accepted; bearer requests must present a live sandbox token.

export const requireAuth = (db: Db, _config: Config): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      // Per-session sandbox token. Resolves session → ticket → project →
      // account so subsequent handlers see req.account just like a normal
      // cookie request. This is the path Phase 4+ uses; the legacy
      // global token below remains for back-compat until Phase 5.
      if (token.startsWith('sb_')) {
        const tokRow = sandboxToken.resolve(db, token)
        if (!tokRow) return next(unauthorized())
        const session = database.sessionGet(db, tokRow.session_id)
        if (!session) return next(unauthorized())
        const ticket = database.ticketGet(db, session.ticket_id)
        if (!ticket) return next(unauthorized())
        const proj = database.projectGet(db, ticket.project_id)
        if (!proj || !proj.owner_id) return next(unauthorized())
        const account = database.accountGet(db, proj.owner_id)
        if (!account) return next(unauthorized())
        req.account = account
        return next()
      }
      return next(unauthorized())
    }
    // Session cookie — real user.
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (!sid) return next(unauthorized())
    const session = database.authSessionGet(db, sid)
    if (!session || new Date(session.expires_at) < new Date()) return next(unauthorized())
    const account = database.accountGet(db, session.account_id)
    if (!account) return next(unauthorized())
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

// ── Rate Limiting ──
//
// Tiny in-memory limiter. Key = req.ip + bucket name. One Map per limiter,
// pruned lazily on access. Single-process design — fine for the home-server
// deploy; would need shared state across instances. Phase 0 ships the
// middleware unmounted; Phase 7 turns it on.

interface Bucket { count: number; resetAt: number }

export function rateLimit(opts: {
  windowMs: number
  max:      number
  keyFn?:   (req: Request) => string
  bucket?:  string
}): RequestHandler {
  const buckets = new Map<string, Bucket>()
  const keyFn   = opts.keyFn ?? ((req: Request) => req.ip ?? 'unknown')
  const tag     = opts.bucket ?? 'default'
  return (req, _res, next) => {
    const key = `${tag}:${keyFn(req)}`
    const nowMs = Date.now()
    let b = buckets.get(key)
    if (!b || b.resetAt < nowMs) {
      b = { count: 0, resetAt: nowMs + opts.windowMs }
      buckets.set(key, b)
    }
    b.count += 1
    if (b.count > opts.max) {
      return next(appError(429, 'rate limit exceeded'))
    }
    next()
  }
}

// ── Error Handler ──

export const errors: ErrorRequestHandler =
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: err.message })
    } else {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'internal error'
      res.status(500).json({ error: msg })
    }
  }
