// In-process adapter for the auth slice. Wraps service.ts entry points
// (authStart, authCallback, authMe, authLogout) and the per-session JWT
// helpers in Result-shaped contracts.
//
// Express middleware (requireAuth, parseCookie, serializeCookie, rateLimit)
// is transport plumbing — the server composition root reaches into
// @foundry/auth directly for those.

import type { Db } from '@foundry/db'
import type { AppError, AuthError } from '@foundry/model'
import * as auth from '@foundry/auth'
import type { AuthConfig, GithubOAuthDeps } from '@foundry/auth'

import type { AuthSlice } from '../slices/auth.js'
import { wrap } from './wrap.js'

export type AuthAdapterDeps = {
  db:         Db
  config:     AuthConfig
  githubDeps: GithubOAuthDeps
}

const toAuthError = (e: AppError): AuthError => {
  switch (e.status) {
    case 401: return { kind: 'not_authenticated' }
    case 403: return { kind: 'invalid_token',     reason: e.message }
    case 429: return { kind: 'rate_limited',      retry_after_ms: 0 }
    default:  return { kind: 'internal',          message: e.message }
  }
}

const w = <T>(fn: () => T | Promise<T>) => wrap<T, AuthError>(fn, toAuthError)

export const createAuthAdapter = (deps: AuthAdapterDeps): AuthSlice => ({
  authStart:    (_ctx, args) => w(() => auth.authStart(deps.config, args.baseUrl, deps.githubDeps)),
  authCallback: (_ctx, args) => w(() => auth.authCallback(
    deps.db, deps.config,
    { code: args.code, state: args.state },
    args.stateCookie, deps.githubDeps,
  )),
  authMe:       (_ctx, account)   => w(() => auth.authMe(account)),
  authLogout:   (_ctx, sessionId) => w(() => auth.authLogout(deps.db, sessionId)),

  sessionJwtMint:   (_ctx, sessionId, ttlMs) => w(() => auth.sessionJwt.mint(deps.db, sessionId, ttlMs)),
  sessionJwtVerify: (_ctx, token) => w(() => {
    const claims = auth.sessionJwt.verify(token)
    if (!claims) throw Object.assign(new Error('invalid sandbox token'), { status: 401, _tag: 'AppError' as const })
    return claims
  }),
})
