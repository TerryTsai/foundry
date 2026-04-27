// Wiring for @foundry/auth. createAuthService binds db + config + crud +
// the github oauth helper callbacks + encryption key, and returns an
// AuthClient backed by the module's pure functions. Owns no runtime
// state beyond what's bound in this closure.

import type { Result } from '@foundry/model'
import { ok, err } from '@foundry/model'
import type { CrudClient } from '@foundry/crud/client'

import { authStart, authCallback, authMe, authLogout } from './flow.js'
import * as sessionJwt from './session-jwt.js'
import type { AuthConfig, GithubOAuthUser, SessionClaims, AuthError } from './schema.js'
import type { AuthClient } from './client.js'

export const createAuthService = (
  config: AuthConfig,
  crud: CrudClient,
  encryptionKey: Buffer,
  oauthAuthorizeUrl: (config: AuthConfig, baseUrl: string, state: string) => string,
  oauthExchangeCode: (config: AuthConfig, code: string) => Promise<string>,
  fetchUser:         (token: string) => Promise<GithubOAuthUser>,
): AuthClient => ({
  authStart:    async (_ctx, args) => ok(authStart(config, args.baseUrl, oauthAuthorizeUrl)),
  authCallback: async (ctx, args)  => authCallback(
    ctx, config, { code: args.code, state: args.state },
    args.stateCookie, oauthExchangeCode, fetchUser, crud,
  ),
  authMe:       async (_ctx, account)   => ok(authMe(account)),
  authLogout:   async (ctx, sessionId)  => authLogout(ctx, sessionId, crud),

  sessionJwtMint:   async (ctx, sessionId, ttlMs) => sessionJwt.mint(ctx, crud, sessionId, ttlMs, encryptionKey),
  sessionJwtVerify: async (_ctx, token) => verifyJwt(token, encryptionKey),
})

function verifyJwt(token: string, key: Buffer): Result<SessionClaims, AuthError> {
  const claims = sessionJwt.verify(token, key)
  if (!claims) return err({ kind: 'invalid_token', reason: 'sandbox token failed verification' })
  return ok(claims)
}
