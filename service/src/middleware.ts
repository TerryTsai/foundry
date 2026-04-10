import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ZodType } from 'zod'
import { AppError, badRequest } from './functional.js'

declare global {
  namespace Express {
    interface Request {
      data?: any
    }
  }
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
