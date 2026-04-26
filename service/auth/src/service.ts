// Wiring for @foundry/auth. createAuthService binds db + config + the
// github oauth deps + the auth-crud callback bag + encryption key, and
// returns an AuthClient backed by the module's pure functions. Owns no
// runtime state beyond what's bound in this closure.

import type { Db } from '@foundry/db'
import type { Result } from '@foundry/model'
import { ok, err } from '@foundry/model'

import { authStart, authCallback, authMe, authLogout } from './flow.js'
import * as sessionJwt from './session-jwt.js'
import type {
  AuthConfig, AuthCrudOps, GithubOAuthDeps, SessionClaims, AuthError,
} from './schema.js'
import type { AuthClient } from './client.js'

export type AuthServiceDeps = {
  db:            Db
  config:        AuthConfig
  githubDeps:    GithubOAuthDeps
  authCrud:      AuthCrudOps
  encryptionKey: Buffer
}

export const createAuthService = (deps: AuthServiceDeps): AuthClient => ({
  authStart:    async (_ctx, args) => ok(authStart(deps.config, args.baseUrl, deps.githubDeps)),
  authCallback: async (_ctx, args) => authCallback(
    deps.db, deps.config, { code: args.code, state: args.state },
    args.stateCookie, deps.githubDeps, deps.authCrud,
  ),
  authMe:       async (_ctx, account)   => ok(authMe(account)),
  authLogout:   async (_ctx, sessionId) => authLogout(deps.db, sessionId, deps.authCrud),

  sessionJwtMint:   async (_ctx, sessionId, ttlMs) => sessionJwt.mint(deps.db, deps.authCrud, sessionId, ttlMs, deps.encryptionKey),
  sessionJwtVerify: async (_ctx, token) => verifyJwt(token, deps.encryptionKey),
})

function verifyJwt(token: string, key: Buffer): Result<SessionClaims, AuthError> {
  const claims = sessionJwt.verify(token, key)
  if (!claims) return err({ kind: 'invalid_token', reason: 'sandbox token failed verification' })
  return ok(claims)
}
