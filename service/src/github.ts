// Minimal GitHub client.
//   - Login flow (OAuth user-to-server): same endpoints whether the registered
//     credentials come from an OAuth App or a GitHub App.
//   - Repo flow (installation tokens): mint an App JWT signed with the App's
//     private key, then exchange for a short-lived installation token.
// No library — both flows are small enough to write directly.
import { createSign } from 'crypto'
import type { Config } from './config.js'

export interface GitHubUser {
  github_id: number
  login:     string
  name:      string | null
  email:     string | null
  avatar_url: string | null
}

export function oauthAuthorizeUrl(config: Config, baseUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id:    config.gitHubClientId,
    redirect_uri: `${baseUrl}/auth/github/callback`,
    state,
    scope:        'read:user user:email',
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function oauthExchangeCode(config: Config, code: string): Promise<string> {
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

// JWT signed with the App's private key, valid for ~9 minutes (GitHub allows up
// to 10). Used as a Bearer token to mint installation access tokens.
export function appJwt(config: Config): string {
  if (!config.gitHubAppId || !config.gitHubAppPrivateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH must be set for App operations')
  }
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: config.gitHubAppId }
  const b64     = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const data    = `${b64(header)}.${b64(payload)}`
  const sig     = createSign('RSA-SHA256').update(data).sign(config.gitHubAppPrivateKey, 'base64url')
  return `${data}.${sig}`
}

// Exchange the App JWT for an installation access token (~1 hour expiry).
// Callers should request fresh tokens rather than caching across calls.
export async function installationToken(config: Config, installationId: number): Promise<{ token: string; expires_at: string }> {
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
