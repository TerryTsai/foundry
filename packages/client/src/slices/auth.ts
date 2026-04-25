// Cross-module surface for @foundry/auth. Adapter wraps throwing service
// calls (authStart, authCallback, authMe, authLogout) into Result-shaped
// contracts. Express middleware (requireAuth, parseCookie/serializeCookie,
// rateLimit) stays internal to the server composition root — those are
// transport plumbing, not cross-module domain calls.

import type { Ctx, Result, AuthError, Account } from '@foundry/model'

export type AuthStartArgs = { baseUrl: string }
export type AuthStartResult = { url: string; state: string }

export type AuthCallbackArgs = {
  code:        string
  state:       string
  stateCookie: string | undefined
}
export type AuthCallbackResult = {
  sessionId: string
  expiresAt: Date
  account:   Account
}

export type AuthMeResult = {
  id:         string
  login:      string
  name:       string | null
  avatar_url: string | null
}

export type AuthSlice = {
  authStart:    (ctx: Ctx, args: AuthStartArgs)    => Promise<Result<AuthStartResult, AuthError>>
  authCallback: (ctx: Ctx, args: AuthCallbackArgs) => Promise<Result<AuthCallbackResult, AuthError>>
  authMe:       (ctx: Ctx, account: Account)       => Promise<Result<AuthMeResult, AuthError>>
  authLogout:   (ctx: Ctx, sessionId: string)      => Promise<Result<{ ok: true }, AuthError>>

  // Per-session sandbox JWT — minted at session start, verified by
  // requireAuth on every sandbox callback.
  sessionJwtMint:   (ctx: Ctx, sessionId: string, ttlMs?: number) => Promise<Result<string, AuthError>>
  sessionJwtVerify: (ctx: Ctx, token: string)                     => Promise<Result<{
    v: 1; sid: string; tid: string; pid: string; aid: string; exp: number
  }, AuthError>>
}
