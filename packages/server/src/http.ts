import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ZodType } from 'zod'
import type { Account } from '@foundry/db'
import type { Result } from '@foundry/model'

declare global {
  namespace Express {
    interface Request {
      data?: any
      account?: Account
    }
  }
}

// ── Validation ──
// Parse `from` (body or query) against a zod schema and stash the
// validated data on req.data. Bad input → 400.

export const parse = <T>(schema: ZodType<T>, from: 'body' | 'query' = 'body'): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[from])
    if (!parsed.success) { res.status(400).json({ error: JSON.stringify(parsed.error.issues) }); return }
    req.data = parsed.data
    next()
  }

// ── Handler wrapper ──
// Lifts a (req) => unknown handler into Express middleware that stores
// its result on res.locals.result for `send` to serialize.

export const run = (fn: (req: Request) => unknown): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = fn(req)
      if (value instanceof Promise) value.then(d => { res.locals.result = d; next() }).catch(next)
      else { res.locals.result = value; next() }
    } catch (e) { next(e) }
  }

// ── Result → HTTP wrapper ──
// Lifts a (req) => Result | Promise<Result> handler into Express
// middleware. ok results land at res.locals.result for `send`. err
// results map kind → HTTP status and short-circuit with a JSON body.

export const runResult = <T, E extends { kind: string }>(fn: (req: Request) => Result<T, E> | Promise<Result<T, E>>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = fn(req)
      if (r instanceof Promise) r.then(v => sendResult(v, res, next)).catch(next)
      else sendResult(r, res, next)
    } catch (e) { next(e) }
  }

function sendResult<T, E extends { kind: string }>(r: Result<T, E>, res: Response, next: NextFunction): void {
  if (r.ok) { res.locals.result = r.value; next(); return }
  res.status(statusFor(r.error.kind)).json({ error: errorMessage(r.error) })
}

function statusFor(kind: string): number {
  switch (kind) {
    case 'not_found':         return 404
    case 'permission_denied':
    case 'forbidden':         return 403
    case 'not_authenticated':
    case 'invalid_token':
    case 'expired_session':   return 401
    case 'rate_limited':      return 429
    case 'conflict':          return 409
    case 'validation_failed':
    case 'invalid_query':
    case 'invalid_args':      return 400
    case 'quota_exceeded':    return 402
    default:                  return 500
  }
}

function errorMessage(error: { kind: string } & Record<string, unknown>): string {
  if (typeof error.reason === 'string') return error.reason
  if (typeof error.message === 'string') return error.message
  return error.kind
}

// ── Response ──

export const send = (status = 200): RequestHandler =>
  (_req: Request, res: Response) => { res.status(status).json(res.locals.result) }

export const sendText: RequestHandler =
  (_req: Request, res: Response) => { res.type('text/plain').send(res.locals.result) }

// ── Error handler ──
// AppError is gone; only programmer errors and transport failures reach
// here. Always 500.

export const errors: ErrorRequestHandler =
  (errVal: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(errVal)
    const msg = errVal instanceof Error ? errVal.message : 'internal error'
    res.status(500).json({ error: msg })
  }
