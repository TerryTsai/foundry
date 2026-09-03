import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Router, type Request, type RequestHandler } from 'express'

import type { Config } from './config.js'
import { exchangeGithubCode, githubRequest } from './github.js'
import type { AccountContext, LocalState } from './local-state.js'

declare global {
  namespace Express { interface Request { foundryAccount?: AccountContext } }
}

export function authRoutes(config: Config, state: LocalState): Router {
  const router = Router()
  router.get('/status', (req, res) => {
    const account = resolveAccount(req, config, state)
    res.json({ connected: Boolean(account), login: account?.login || config.ownerGithubLogin || null, oauthConfigured: Boolean(config.githubClientId && config.githubClientSecret) })
  })
  router.get('/github', (req, res) => {
    if (!config.githubClientId) return res.status(503).json({ error: 'GitHub OAuth is not configured' })
    const oauthState = randomBytes(24).toString('hex')
    res.setHeader('Set-Cookie', cookie('foundry_oauth', oauthState, config.cookieSecure, 600))
    const redirect = `${requestBaseUrl(req)}/auth/github/callback`
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.githubClientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=repo&state=${oauthState}`)
  })
  router.get('/github/callback', async (req, res, next) => {
    try {
      if (!safeEqual(readCookie(req, 'foundry_oauth'), String(req.query.state || ''))) return res.status(400).json({ error: 'Invalid OAuth state' })
      const token = await exchangeGithubCode(config.githubClientId, config.githubClientSecret, String(req.query.code || ''))
      const user = await githubRequest<{ login: string }>(token, '/user')
      if (config.ownerGithubLogin && user.login.toLowerCase() !== config.ownerGithubLogin.toLowerCase()) return res.status(403).json({ error: 'This GitHub account is not allowed' })
      state.saveAccount(user.login, token)
      const session = state.createSession(user.login)
      res.setHeader('Set-Cookie', [cookie('foundry_session', session.id, config.cookieSecure, 30 * 24 * 60 * 60), cookie('foundry_oauth', '', config.cookieSecure, 0)])
      res.redirect('/')
    } catch (error) { next(error) }
  })
  router.post('/logout', (req, res) => {
    const id = readCookie(req, 'foundry_session')
    if (id) state.removeSession(id)
    res.setHeader('Set-Cookie', cookie('foundry_session', '', config.cookieSecure, 0))
    res.status(204).end()
  })
  return router
}

export function requireAccount(config: Config, state: LocalState): RequestHandler {
  return (req, res, next) => {
    const account = resolveAccount(req, config, state)
    if (!account) return res.status(401).json({ error: 'Connect Foundry to GitHub first' })
    req.foundryAccount = account
    next()
  }
}

function resolveAccount(req: Request, config: Config, state: LocalState): AccountContext | null {
  if (config.githubToken) return { login: config.ownerGithubLogin || 'local', token: config.githubToken }
  const session = readCookie(req, 'foundry_session')
  return session ? state.accountForSession(session) : null
}

function requestBaseUrl(req: Request): string {
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0]?.trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0]?.trim()
  return `${protocol}://${host}`
}

function readCookie(req: Request, name: string): string {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return ''
}

function cookie(name: string, value: string, secure: boolean, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function safeEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}
