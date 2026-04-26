// Cross-service contract for @foundry/auth. Types only — no value
// imports beyond schema.ts and @foundry/model. Express middleware
// (requireAuth, parseCookie, rateLimit) is intentionally NOT here —
// that's transport plumbing exposed via @foundry/auth/middleware.

import type { Ctx, Result } from '@foundry/model'
import type { Account } from '@foundry/db'

import type { AuthCallbackResult, SessionClaims, AuthError } from './schema.js'

export type AuthStartArgs = { baseUrl: string }
export type AuthStartResult = { url: string; state: string }

export type AuthCallbackArgs = {
  code:        string
  state:       string
  stateCookie: string | undefined
}

export type AuthMeResult = {
  id:         string
  login:      string
  name:       string | null
  avatar_url: string | null
}

export type AuthClient = {
  authStart:    (ctx: Ctx, args: AuthStartArgs)    => Promise<Result<AuthStartResult, AuthError>>
  authCallback: (ctx: Ctx, args: AuthCallbackArgs) => Promise<Result<AuthCallbackResult, AuthError>>
  authMe:       (ctx: Ctx, account: Account)       => Promise<Result<AuthMeResult, AuthError>>
  authLogout:   (ctx: Ctx, sessionId: string)      => Promise<Result<{ ok: true }, AuthError>>

  // Per-session sandbox JWT — minted at session start, verified by
  // requireAuth on every sandbox callback.
  sessionJwtMint:   (ctx: Ctx, sessionId: string, ttlMs: number) => Promise<Result<string, AuthError>>
  sessionJwtVerify: (ctx: Ctx, token: string)                     => Promise<Result<SessionClaims, AuthError>>
}
