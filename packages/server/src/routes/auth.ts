import { Router, type Request } from 'express'
import type { Db } from '@foundry/db'
import type { Config } from '../config.js'
import { parse } from '../http.js'
import {
  authStart, authCallback, authMe, authLogout, AUTH_STATE_TTL_SEC,
  parseCookie, serializeCookie, requireAuth,
  validate,
  type AuthCrudOps, type GithubOAuthDeps,
} from '@foundry/auth'
import { github } from '@foundry/mcp'

// Build the user-facing base URL from the incoming request. Honours
// X-Forwarded-* headers so a reverse proxy in front of the service still
// produces the right callback. No PUBLIC_BASE_URL config required — the
// OAuth callback URL just has to match whatever's registered in the GitHub
// OAuth app for the host you're using.
function requestBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim()
            ?? (req.secure ? 'https' : 'http')
  const host  = (req.headers['x-forwarded-host']  as string)?.split(',')[0]?.trim()
            ?? req.headers.host
  return `${proto}://${host}`
}

// eslint-disable-next-line max-lines-per-function -- legacy; refactor in Phase 7
export function authRoutes(db: Db, config: Config, authCrud: AuthCrudOps) {
  const r = Router()

  // Inject the GitHub OAuth helpers from @foundry/mcp into the auth
  // module. auth is a logic module; the manifest check forbids it from
  // importing @foundry/mcp directly. Thin closures adapt the signatures —
  // auth passes AuthConfig; the underlying mcp helpers want McpConfig.
  // The full service Config satisfies both structurally; the closures
  // bridge the type aliases.
  const githubDeps: GithubOAuthDeps = {
    oauthAuthorizeUrl: (_authConfig, baseUrl, state) => github.oauthAuthorizeUrl(config, baseUrl, state),
    oauthExchangeCode: (_authConfig, code)           => github.oauthExchangeCode(config, code),
    fetchUser:         (token)                       => github.fetchUser(token),
  }

  // Begin OAuth: stash a random `state` in a short-lived cookie, redirect to GitHub.
  r.get('/github', (req, res) => {
    const { url, state } = authStart(config, requestBaseUrl(req), githubDeps)
    res.setHeader('Set-Cookie', serializeCookie('oauth_state', state, {
      maxAge: AUTH_STATE_TTL_SEC, secure: config.cookieSecure, sameSite: 'Lax',
    }))
    res.redirect(302, url)
  })

  // OAuth callback: validate state, exchange code, upsert account, mint session.
  r.get('/github/callback', parse(validate.authCallback, 'query'), async (req, res, next) => {
    try {
      const stateCookie = parseCookie(req.headers.cookie, 'oauth_state')
      const { sessionId, expiresAt } = await authCallback(db, config, req.data, stateCookie, githubDeps, authCrud)
      const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      res.setHeader('Set-Cookie', [
        serializeCookie('oauth_state', '', { maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax' }),
        serializeCookie('foundry_session', sessionId, { maxAge, secure: config.cookieSecure, sameSite: 'Lax' }),
      ])
      res.redirect(302, '/')
    } catch (err) {
      next(err)
    }
  })

  r.get('/me', requireAuth(db, config, authCrud), (req, res) => {
    res.json(authMe(req.account!))
  })

  r.post('/logout', (req, res) => {
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (sid) authLogout(db, sid, authCrud)
    res.setHeader('Set-Cookie', serializeCookie('foundry_session', '', {
      maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax',
    }))
    res.status(204).end()
  })

  return r
}
