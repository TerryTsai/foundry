// Public surface for @foundry/auth.

export * as validate from './schema.js'

// service — login flow + session lookup helpers
export {
  authStart, authCallback, authMe, authLogout,
} from './service.js'

// middleware — cookie helpers + requireAuth
export {
  parseCookie, serializeCookie, requireAuth,
} from './middleware.js'

// session-jwt — per-session sandbox JWT mint/verify
export * as sessionJwt from './session-jwt.js'

// ratelimit — tiny in-memory limiter
export { rateLimit } from './ratelimit.js'

// types — config slice + cross-module callbacks + result shapes
export type {
  AuthConfig, AuthCrudOps, GithubOAuthDeps, GithubOAuthUser,
  AuthCallbackResult, SessionClaims, CookieOpts,
} from './schema.js'
