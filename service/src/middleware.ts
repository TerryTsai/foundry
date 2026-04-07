import type { Request, Response, NextFunction } from 'express'
import type { ZodType } from 'zod'
import { type Result, ok, badRequest } from './errors.js'

// ── Parsing ──

export const parseBody = <T>(schema: ZodType<T>) => (req: Request): Result<T> => {
  const parsed = schema.safeParse(req.body)
  return parsed.success ? ok(parsed.data) : badRequest(JSON.stringify(parsed.error.flatten()))
}

export const parseQuery = <T>(schema: ZodType<T>) => (req: Request): Result<T> => {
  const parsed = schema.safeParse(req.query)
  return parsed.success ? ok(parsed.data) : badRequest(JSON.stringify(parsed.error.flatten()))
}

// ── Result Sending ──

export const sendResult = (res: Response) => <T>(result: Result<T>): void => {
  result.ok
    ? res.json(result.data) as unknown as void
    : res.status(result.status).json({ error: result.error }) as unknown as void
}

export const sendCreated = (res: Response) => <T>(result: Result<T>): void => {
  result.ok
    ? res.status(201).json(result.data) as unknown as void
    : res.status(result.status).json({ error: result.error }) as unknown as void
}

export const sendText = (res: Response) => (result: Result<string>): void => {
  result.ok
    ? res.type('text/plain').send(result.data) as unknown as void
    : res.status(result.status).json({ error: result.error }) as unknown as void
}

// ── Chaining ──

export const andThen = <A, B>(result: Result<A>, fn: (a: A) => Result<B>): Result<B> =>
  result.ok ? fn(result.data) : result

export const andThenAsync = <A, B>(result: Result<A>, fn: (a: A) => Promise<Result<B>>): Promise<Result<B>> =>
  result.ok ? fn(result.data) : Promise.resolve(result)

// ── Async Route Wrapper ──

export const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
