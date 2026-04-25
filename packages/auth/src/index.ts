// Public surface for @foundry/auth.

export * as validate from './validators.js'

// service — login flow + session lookup helpers
export {
  authStart, authCallback, authMe, authLogout, AUTH_STATE_TTL_SEC,
} from './service.js'

// middleware — cookie helpers + requireAuth
export {
  parseCookie, serializeCookie, requireAuth,
} from './middleware.js'

// session-jwt — per-session sandbox JWT mint/verify
export * as sessionJwt from './session-jwt.js'

// ratelimit — tiny in-memory limiter
export { rateLimit } from './ratelimit.js'

// types — config slice + cross-module callbacks
export type {
  AuthConfig, AuthCrudOps, GithubOAuthDeps, GithubOAuthUser,
} from './types.js'
