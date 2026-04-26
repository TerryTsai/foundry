// Shapes for @foundry/auth. Types only — zod validators live in
// validate.ts. Cross-module callback bundles, config slice, sandbox
// JWT claims, cookie/rate-limit options.

import type { Db, Account, AuthSession, Project, Session, Ticket } from '@foundry/db'

export type { OauthCallbackQuery } from './validate.js'

// ── Config slice ─────────────────────────────────────────────────────
// AuthConfig is the minimal surface of the service-wide Config that auth
// needs. The composition root passes the full Config; TS structural
// typing makes that compatible.

export interface AuthConfig {
  gitHubClientId:           string
  gitHubClientSecret:       string
  gitHubAppId?:             number
  gitHubAppPrivateKey?:     string
  gitHubAppPrivateKeyPath?: string
  ownerGitHubLogin?:        string
  allowedGithubLogins:      string[]
  cookieSecure:             boolean
  sessionMaxAgeSec:         number
  internalApiToken:         string
}

// ── Cross-module callbacks ────────────────────────────────────────
// auth is a logic module; it cannot import @foundry/mcp directly
// (manifest check). The composition root (server) injects the github
// OAuth helpers from @foundry/mcp via this dependency bag.

export interface GithubOAuthUser {
  github_id:  number
  login:      string
  name:       string | null
  email:      string | null
  avatar_url: string | null
}

export interface GithubOAuthDeps {
  oauthAuthorizeUrl: (config: AuthConfig, baseUrl: string, state: string) => string
  oauthExchangeCode: (config: AuthConfig, code: string) => Promise<string>
  fetchUser:         (token: string) => Promise<GithubOAuthUser>
}

// auth also cannot import @foundry/crud — persistence access goes via
// these callbacks, bound by the composition root from crud's helpers.

export interface AuthCrudOps {
  accountGet:               (db: Db, id: string) => Account | undefined
  accountUpsertByGithubId:  (db: Db, data: GithubOAuthUser) => Account
  authSessionGet:           (db: Db, id: string) => AuthSession | undefined
  authSessionInsert:        (db: Db, data: { id: string; account_id: string; created_at: string; expires_at: string }) => AuthSession
  authSessionRemove:        (db: Db, id: string) => void
  claimUnownedProjects:     (db: Db, ownerLogin: string) => number
  // For session-jwt mint: walk session → ticket → project to capture
  // the (sid, tid, pid, aid) chain.
  sessionGet:               (db: Db, id: string) => Session | undefined
  ticketGet:                (db: Db, id: string) => Ticket | undefined
  projectGet:               (db: Db, id: string) => Project | undefined
}

// ── Result shapes ────────────────────────────────────────────────────

export interface AuthCallbackResult {
  sessionId: string
  expiresAt: Date
  account:   Account
}

// ── Sandbox JWT claims ───────────────────────────────────────────────
// Per-session sandbox auth — stateless HMAC-SHA256 JWT.
// On the wire:  sb_<base64url(json(claims))>.<base64url(hmac-sha256)>

export interface SessionClaims {
  v:   1
  sid: string
  tid: string
  pid: string
  aid: string
  exp: number
}

// ── Cookie helpers ───────────────────────────────────────────────────

export interface CookieOpts {
  maxAge?:   number
  secure?:   boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  path?:     string
  httpOnly?: boolean
}

// ── Rate limiter ─────────────────────────────────────────────────────

import type { Request, Response } from 'express'

export interface RateLimitBucket { count: number; resetAt: number }

export interface RateLimitOpts {
  windowMs: number
  max:      number
  keyFn?:   (req: Request) => string
  bucket?:  string
}

export interface RateLimitTickArgs {
  buckets: Map<string, RateLimitBucket>
  opts:    RateLimitOpts
  keyFn:   (req: Request) => string
  tag:     string
  req:     Request
  res:     Response
  next:    () => void
}

// ── Error union ─────────────────────────────────────────────────────

export type AuthError =
  | { kind: 'invalid_token';     reason: string }
  | { kind: 'expired_session' }
  | { kind: 'not_authenticated' }
  | { kind: 'forbidden';         reason: string }
  | { kind: 'validation_failed'; field: string; reason: string }
  | { kind: 'rate_limited';      retry_after_ms: number }
  | { kind: 'not_found';         entity: string; id: string }
  | { kind: 'internal';          message: string }
