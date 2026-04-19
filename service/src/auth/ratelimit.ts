import type { Request, RequestHandler } from 'express'
import { appError } from '../core/errors.js'

// Tiny in-memory rate limiter. Key = bucket name + custom key (default
// req.ip). One Map per limiter instance; pruned lazily on access.
// Single-process design — fine for a single-machine deployment; would
// need shared state across instances.

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
