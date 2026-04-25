// Module-internal types for @foundry/auth.
//
// AuthConfig is the minimal surface of the service-wide Config that auth
// needs. The route layer / composition root passes the full Config; TS
// structural typing makes that compatible.

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
