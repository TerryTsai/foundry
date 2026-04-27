// Public surface for @foundry/auth.

export { createAuthService } from './service.js'
export type { AuthClient } from './client.js'

export * as validate from './validate.js'

// types — config slice + result shapes + errors
export type {
  AuthConfig, GithubOAuthUser,
  AuthCallbackResult, SessionClaims, CookieOpts, AuthError,
} from './schema.js'

// Raw exports remain during the @foundry/client → per-service migration.
export {
  authStart, authCallback, authMe, authLogout,
} from './flow.js'

export {
  parseCookie, serializeCookie, requireAuth,
} from './middleware.js'

export * as sessionJwt from './session-jwt.js'

export { rateLimit } from './ratelimit.js'
