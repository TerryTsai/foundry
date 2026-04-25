// Minimal GitHub client.
//   - Login flow (OAuth user-to-server): same endpoints whether the registered
//     credentials come from an OAuth App or a GitHub App.
//   - Repo flow (installation tokens): mint an App JWT signed with the App's
//     private key, then exchange for a short-lived installation token.
// No library — both flows are small enough to write directly.
import { createSign } from 'crypto'
import type { McpConfig } from '../../types.js'

export interface GitHubUser {
  github_id: number
  login:     string
  name:      string | null
  email:     string | null
  avatar_url: string | null
}

export function oauthAuthorizeUrl(config: McpConfig, baseUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id:    config.gitHubClientId,
    redirect_uri: `${baseUrl}/auth/github/callback`,
    state,
    scope:        'read:user user:email',
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function oauthExchangeCode(config: McpConfig, code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({
      client_id:     config.gitHubClientId,
      client_secret: config.gitHubClientSecret,
      code,
    }),
  })
  if (!res.ok) throw new Error(`github token exchange failed: ${res.status}`)
  const json = await res.json() as { access_token?: string; error?: string }
  if (!json.access_token) throw new Error(`github token exchange returned no token: ${json.error ?? 'unknown'}`)
  return json.access_token
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export async function fetchUser(token: string): Promise<GitHubUser> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  const userRes = await fetch('https://api.github.com/user', { headers })
  if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`)
  const u = await userRes.json() as { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null }

  // GitHub /user only returns email if it's set as public. Fall back to /user/emails for the verified primary.
  let email = u.email
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', { headers })
    if (emailRes.ok) {
      const list = await emailRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>
      email = list.find(e => e.primary && e.verified)?.email ?? null
    }
  }

  return { github_id: u.id, login: u.login, name: u.name, email, avatar_url: u.avatar_url }
}

// ── GitHub App: installation tokens ──

// JWT signed with the App's private key. GitHub caps exp at 10 minutes from
// iat; we use a tight 2-minute window so any local clock skew (this machine's
// clock has drifted ~minute ahead of GitHub's before) still leaves headroom.
// The token only needs to live long enough for one /app/installations call.
export function appJwt(config: McpConfig): string {
  if (!config.gitHubAppId || !config.gitHubAppPrivateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH must be set for App operations')
  }
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 60, iss: config.gitHubAppId }
  const b64     = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const data    = `${b64(header)}.${b64(payload)}`
  const sig     = createSign('RSA-SHA256').update(data).sign(config.gitHubAppPrivateKey, 'base64url')
  return `${data}.${sig}`
}

// Exchange the App JWT for an installation access token (~1 hour expiry).
// Callers should request fresh tokens rather than caching across calls.
export async function installationToken(config: McpConfig, installationId: number): Promise<{ token: string; expires_at: string }> {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${appJwt(config)}`,
      Accept:        'application/vnd.github+json',
    },
  })
  if (!res.ok) throw new Error(`installation token mint failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ token: string; expires_at: string }>
}

// Look up which installation gives access to a given repo. Used at session
// start to find the right installation_id without storing it on the project.
export async function installationForRepo(config: McpConfig, owner: string, repo: string): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: {
      Authorization: `Bearer ${appJwt(config)}`,
      Accept:        'application/vnd.github+json',
    },
  })
  if (res.status === 404) throw new Error(`GitHub App is not installed on ${owner}/${repo}`)
  if (!res.ok) throw new Error(`installation lookup failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { id: number }
  return json.id
}

// Mint a fresh clone URL for the repo with the installation token embedded as
// the basic-auth user. Token is short-lived (~1h) so this URL must not be
// persisted anywhere.
export async function repoCloneUrl(config: McpConfig, owner: string, repo: string): Promise<string> {
  const installationId = await installationForRepo(config, owner, repo)
  const { token } = await installationToken(config, installationId)
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
}

// Open a pull request. Draft by default — session branches should land as
// drafts so a human flips them to Ready only after reviewing the agent's work.
// Returns the PR's html_url.
// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export async function pullRequestCreate(
  config: McpConfig,
  owner: string,
  repo: string,
  input: { title: string; head: string; base: string; body: string; draft?: boolean },
): Promise<string> {
  const installationId = await installationForRepo(config, owner, repo)
  const { token }      = await installationToken(config, installationId)
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      Accept:         'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      head:  input.head,
      base:  input.base,
      body:  input.body,
      draft: input.draft ?? true,
    }),
  })
  if (!res.ok) throw new Error(`pull request create failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { html_url: string }
  return json.html_url
}

// List installations the signed-in user can access. Called with a fresh user
// access token (the one we throw away after login). Useful when we later need
// to discover which installation_id to mint tokens against on the user's behalf.
export async function userInstallations(userToken: string): Promise<Array<{ id: number; account: { login: string; type: string } }>> {
  const res = await fetch('https://api.github.com/user/installations', {
    headers: { Authorization: `Bearer ${userToken}`, Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`/user/installations failed: ${res.status}`)
  const json = await res.json() as { installations: Array<{ id: number; account: { login: string; type: string } }> }
  return json.installations
}
