import { Router, type Request } from 'express'
import type { Db } from '../core/db.js'
import type { Config } from '../core/config.js'
import { parse } from '../core/http.js'
import { authStart, authCallback, authMe, authLogout, AUTH_STATE_TTL_SEC } from './service.js'
import { parseCookie, serializeCookie, requireAuth } from './middleware.js'
import * as validate from './schema.js'

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

export function authRoutes(db: Db, config: Config) {
  const r = Router()

  // Begin OAuth: stash a random `state` in a short-lived cookie, redirect to GitHub.
  r.get('/github', (req, res) => {
    const { url, state } = authStart(config, requestBaseUrl(req))
    res.setHeader('Set-Cookie', serializeCookie('oauth_state', state, {
      maxAge: AUTH_STATE_TTL_SEC, secure: config.cookieSecure, sameSite: 'Lax',
    }))
    res.redirect(302, url)
  })

  // OAuth callback: validate state, exchange code, upsert account, mint session.
  r.get('/github/callback', parse(validate.authCallback, 'query'), async (req, res, next) => {
    try {
      const stateCookie = parseCookie(req.headers.cookie, 'oauth_state')
      const { sessionId, expiresAt } = await authCallback(db, config, req.data, stateCookie)
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

  r.get('/me', requireAuth(db, config), (req, res) => {
    res.json(authMe(req.account!))
  })

  r.post('/logout', (req, res) => {
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (sid) authLogout(db, sid)
    res.setHeader('Set-Cookie', serializeCookie('foundry_session', '', {
      maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax',
    }))
    res.status(204).end()
  })

  return r
}
