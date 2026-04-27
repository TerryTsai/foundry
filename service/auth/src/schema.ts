// Shapes for @foundry/auth. Types only — zod validators live in
// validate.ts. Config slice, sandbox JWT claims, cookie/rate-limit
// options. Cross-module access goes through CrudClient (data) and
// positional callbacks for the github OAuth helpers (mcp boundary).

import type { Account } from '@foundry/db'

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

// ── GitHub OAuth user shape (returned by mcp's github fetchUser
//    callback that the composition root passes into authCallback) ──

export interface GithubOAuthUser {
  github_id:  number
  login:      string
  name:       string | null
  email:      string | null
  avatar_url: string | null
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
