// Minimal GitHub OAuth client. Two POST/GETs is enough; no library.
import type { Config } from './config.js'

export interface GitHubUser {
  github_id: number
  login:     string
  name:      string | null
  email:     string | null
  avatar_url: string | null
}

export function oauthAuthorizeUrl(config: Config, state: string): string {
  const params = new URLSearchParams({
    client_id:    config.gitHubClientId,
    redirect_uri: `${config.publicBaseUrl}/auth/github/callback`,
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
