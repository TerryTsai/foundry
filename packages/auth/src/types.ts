// Module-internal types for @foundry/auth.
//
// AuthConfig is the minimal surface of the service-wide Config that auth
// needs. The route layer / composition root passes the full Config; TS
// structural typing makes that compatible.

import type { Db, Account, AuthSession, Project, Session, Ticket } from '@foundry/db'

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
