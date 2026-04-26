import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Db } from '@foundry/db'
import type { Config } from '../config.js'
import { parse, data } from '../http.js'
import {
  authStart, authCallback, authMe, authLogout, AUTH_STATE_TTL_SEC,
  parseCookie, serializeCookie, requireAuth,
  validate,
  type AuthCrudOps, type GithubOAuthDeps,
} from '@foundry/auth'
import { github } from '@foundry/mcp'

function requestBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim()
            ?? (req.secure ? 'https' : 'http')
  const host  = (req.headers['x-forwarded-host']  as string)?.split(',')[0]?.trim()
            ?? req.headers.host
  return `${proto}://${host}`
}

export function authRoutes(db: Db, config: Config, authCrud: AuthCrudOps) {
  const r = Router()
  const githubDeps = bridgeGithubDeps(config)
  r.get('/github', (req, res) => handleAuthStart(req, res, config, githubDeps))
  r.get('/github/callback', parse(validate.authCallback, 'query'), (req, res, next) => handleAuthCallback(db, config, githubDeps, authCrud, req, res, next))
  r.get('/me', requireAuth(db, config, authCrud), (req, res) => res.json(authMe(req.account!)))
  r.post('/logout', (req, res) => handleAuthLogout(db, config, authCrud, req, res))
  return r
}

function bridgeGithubDeps(config: Config): GithubOAuthDeps {
  return {
    oauthAuthorizeUrl: (_authConfig, baseUrl, state) => github.oauthAuthorizeUrl(config, baseUrl, state),
    oauthExchangeCode: (_authConfig, code)           => github.oauthExchangeCode(config, code),
    fetchUser:         (token)                       => github.fetchUser(token),
  }
}

function handleAuthStart(req: Request, res: Response, config: Config, githubDeps: GithubOAuthDeps): void {
  const { url, state } = authStart(config, requestBaseUrl(req), githubDeps)
  res.setHeader('Set-Cookie', serializeCookie('oauth_state', state, {
    maxAge: AUTH_STATE_TTL_SEC, secure: config.cookieSecure, sameSite: 'Lax',
  }))
  res.redirect(302, url)
}

async function handleAuthCallback(
  db: Db, config: Config, githubDeps: GithubOAuthDeps, authCrud: AuthCrudOps,
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const stateCookie = parseCookie(req.headers.cookie, 'oauth_state')
    const r = await authCallback(db, config, data(validate.authCallback, req), stateCookie, githubDeps, authCrud)
    if (!r.ok) { res.status(r.error.kind === 'forbidden' ? 403 : 400).json({ error: r.error }); return }
    setSessionCookies(res, config, r.value.sessionId, r.value.expiresAt)
    res.redirect(302, '/')
  } catch (errVal) { next(errVal) }
}

function setSessionCookies(res: Response, config: Config, sessionId: string, expiresAt: Date): void {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  res.setHeader('Set-Cookie', [
    serializeCookie('oauth_state', '', { maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax' }),
    serializeCookie('foundry_session', sessionId, { maxAge, secure: config.cookieSecure, sameSite: 'Lax' }),
  ])
}

function handleAuthLogout(db: Db, config: Config, authCrud: AuthCrudOps, req: Request, res: Response): void {
  const sid = parseCookie(req.headers.cookie, 'foundry_session')
  if (sid) authLogout(db, sid, authCrud)
  res.setHeader('Set-Cookie', serializeCookie('foundry_session', '', {
    maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax',
  }))
  res.status(204).end()
}
