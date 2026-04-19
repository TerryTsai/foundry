import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ZodType } from 'zod'
import { badRequest, isAppError } from './errors.js'
import type { Account } from './schema.js'

declare global {
  namespace Express {
    interface Request {
      data?: any
      account?: Account
    }
  }
}

// ── Validation ──
// Parse `from` (body or query) against a zod schema and stash the validated
// data on req.data for the handler. Bad input throws badRequest(400).

export const parse = <T>(schema: ZodType<T>, from: 'body' | 'query' = 'body'): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[from])
    if (!result.success) throw badRequest(JSON.stringify(result.error.issues))
    req.data = result.data
    next()
  }

// ── Handler wrapper ──
// Lifts a (req) => unknown handler into Express middleware that stores its
// result on res.locals.result for the send middleware to serialize. Handles
// both sync values and promises uniformly.

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

// ── Error handler ──

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
