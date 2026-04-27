import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Config } from '../config.js'
import { makeCtx } from '@foundry/model'
import { parse, data } from '../http.js'
import {
  authStart, authCallback, authMe, authLogout,
  parseCookie, serializeCookie, requireAuth,
  validate, type AuthConfig,
} from '@foundry/auth'
import type { CrudClient } from '@foundry/crud/client'
import { github } from '@foundry/mcp'

function requestBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim()
            ?? (req.secure ? 'https' : 'http')
  const host  = (req.headers['x-forwarded-host']  as string)?.split(',')[0]?.trim()
            ?? req.headers.host
  return `${proto}://${host}`
}

export function authRoutes(config: Config, crud: CrudClient, encryptionKey: Buffer) {
  const r = Router()
  const oauthAuthorizeUrl = (_c: AuthConfig, baseUrl: string, state: string) => github.oauthAuthorizeUrl(config, baseUrl, state)
  const oauthExchangeCode = (_c: AuthConfig, code: string) => github.oauthExchangeCode(config, code)
  const fetchUser         = (token: string) => github.fetchUser(token)
  r.get('/github', (req, res) => handleAuthStart(req, res, config, oauthAuthorizeUrl))
  r.get('/github/callback', parse(validate.oauthCallbackQuery, 'query'), (req, res, next) => handleAuthCallback(config, crud, oauthExchangeCode, fetchUser, req, res, next))
  r.get('/me', requireAuth(crud, encryptionKey), (req, res) => res.json(authMe(req.account!)))
  r.post('/logout', (req, res) => handleAuthLogout(crud, config, req, res))
  return r
}

function handleAuthStart(
  req: Request, res: Response, config: Config,
  oauthAuthorizeUrl: (config: AuthConfig, baseUrl: string, state: string) => string,
): void {
  const { url, state } = authStart(config, requestBaseUrl(req), oauthAuthorizeUrl)
  res.setHeader('Set-Cookie', serializeCookie('oauth_state', state, {
    maxAge: 60 * 10, secure: config.cookieSecure, sameSite: 'Lax',
  }))
  res.redirect(302, url)
}

async function handleAuthCallback(
  config: Config, crud: CrudClient,
  oauthExchangeCode: (c: AuthConfig, code: string) => Promise<string>,
  fetchUser: (token: string) => Promise<{ github_id: number; login: string; name: string | null; email: string | null; avatar_url: string | null }>,
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const stateCookie = parseCookie(req.headers.cookie, 'oauth_state')
    const ctx = makeCtx({ accountId: 'system' })
    const r = await authCallback(ctx, config, data(validate.oauthCallbackQuery, req), stateCookie, oauthExchangeCode, fetchUser, crud)
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

async function handleAuthLogout(crud: CrudClient, config: Config, req: Request, res: Response): Promise<void> {
  const sid = parseCookie(req.headers.cookie, 'foundry_session')
  if (sid) await authLogout(makeCtx({ accountId: 'system' }), sid, crud)
  res.setHeader('Set-Cookie', serializeCookie('foundry_session', '', {
    maxAge: 0, secure: config.cookieSecure, sameSite: 'Lax',
  }))
  res.status(204).end()
}
