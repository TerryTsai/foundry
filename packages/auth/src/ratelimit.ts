import type { Request, Response, RequestHandler } from 'express'

// Tiny in-memory rate limiter. Key = bucket name + custom key (default
// req.ip). Single-process design — fine for a single-machine deployment.

interface Bucket { count: number; resetAt: number }

export interface RateLimitOpts {
  windowMs: number
  max:      number
  keyFn?:   (req: Request) => string
  bucket?:  string
}

export function rateLimit(opts: RateLimitOpts): RequestHandler {
  const buckets = new Map<string, Bucket>()
  const keyFn   = opts.keyFn ?? ((req: Request) => req.ip ?? 'unknown')
  const tag     = opts.bucket ?? 'default'
  return (req, res, next) => rateLimitTick({ buckets, opts, keyFn, tag, req, res, next })
}

interface TickArgs {
  buckets: Map<string, Bucket>; opts: RateLimitOpts
  keyFn: (req: Request) => string; tag: string
  req: Request; res: Response; next: () => void
}

function rateLimitTick(args: TickArgs): void {
  const key = `${args.tag}:${args.keyFn(args.req)}`
  const b = bucketFor(args.buckets, key, args.opts.windowMs)
  b.count += 1
  if (b.count > args.opts.max) { args.res.status(429).json({ error: 'rate limit exceeded' }); return }
  args.next()
}

function bucketFor(buckets: Map<string, Bucket>, key: string, windowMs: number): Bucket {
  const nowMs = Date.now()
  const existing = buckets.get(key)
  if (existing && existing.resetAt >= nowMs) return existing
  const fresh = { count: 0, resetAt: nowMs + windowMs }
  buckets.set(key, fresh)
  return fresh
}
