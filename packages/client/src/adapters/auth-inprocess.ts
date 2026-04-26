// In-process adapter for the auth slice. Underlying functions return
// Result natively; this adapter is a pass-through.

import type { Db } from '@foundry/db'
import type { AuthError, Result } from '@foundry/model'
import { ok, err } from '@foundry/model'
import * as auth from '@foundry/auth'
import type { AuthConfig, AuthCrudOps, GithubOAuthDeps } from '@foundry/auth'

import type { AuthSlice } from '../slices/auth.js'

export type AuthAdapterDeps = {
  db:            Db
  config:        AuthConfig
  githubDeps:    GithubOAuthDeps
  authCrud:      AuthCrudOps
  encryptionKey: Buffer
}

export const createAuthAdapter = (deps: AuthAdapterDeps): AuthSlice => ({
  authStart:    async (_ctx, args) => ok(auth.authStart(deps.config, args.baseUrl, deps.githubDeps)),
  authCallback: async (_ctx, args) => auth.authCallback(
    deps.db, deps.config, { code: args.code, state: args.state },
    args.stateCookie, deps.githubDeps, deps.authCrud,
  ),
  authMe:       async (_ctx, account)   => ok(auth.authMe(account)),
  authLogout:   async (_ctx, sessionId) => auth.authLogout(deps.db, sessionId, deps.authCrud),

  sessionJwtMint:   async (_ctx, sessionId, ttlMs) => auth.sessionJwt.mint(deps.db, deps.authCrud, sessionId, ttlMs, deps.encryptionKey),
  sessionJwtVerify: async (_ctx, token) => verifyJwt(token, deps.encryptionKey),
})

function verifyJwt(token: string, key: Buffer): Result<{ v: 1; sid: string; tid: string; pid: string; aid: string; exp: number }, AuthError> {
  const claims = auth.sessionJwt.verify(token, key)
  if (!claims) return err({ kind: 'invalid_token', reason: 'sandbox token failed verification' })
  return ok(claims)
}
