import { Router, type Request } from 'express'
import type { Db } from './database.js'
import type { Config } from './config.js'
import { authStart, authCallback, authMe, authLogout, AUTH_STATE_TTL_SEC } from './domain/auth.js'
import { projectList, projectGet, projectCreate, projectUpdate, projectRun, projectTagList } from './domain/projects.js'
import { analytics } from './domain/analytics.js'
import { connectionList, connectionGet, connectionCreate, connectionUpdate, connectionRemove } from './domain/connections.js'
import {
  ticketList, ticketGet, ticketCreate, ticketUpdate,
  ticketCancel, ticketDependencyChain,
  commentList, commentCreate, tagList, tagAdd, tagRemove, verdictList,
} from './domain/tickets.js'
import { agentMcpList, agentList, agentGet, agentCreate, agentUpdate, agentRemove } from './domain/agents.js'
import { sessionGet, sessionStatus, sessionKill, sessionActivities, sessionByTicket, sessionListAll } from './domain/sessions.js'
import { executionList, executionGet, executionBySession, executionCreate, executionKill, executionStream } from './domain/executions.js'
import { ticketUsage, agentUsage, sessionUsage } from './domain/usage.js'
import * as validate from './validate.js'
import { unauthorized } from './errors.js'
import { parse, run, send, parseCookie, serializeCookie, requireAuth } from './middleware.js'
import { TOOL_NAMES, registry } from './mcp/registry.js'
import * as providers from './connections/registry.js'

// Each project handler resolves the caller's account from req (set by
// requireAuth) and forwards it to the domain layer for ownership checks.
function accountId(req: Request): string {
  if (!req.account) throw unauthorized()
  return req.account.id
}

// Auth session account preferred; falls back to explicit query param for
// internal bearer-token calls (MCP tools curling back into the service).
function accountIdOrQuery(req: Request): string {
  if (req.account) return req.account.id
  const qid = (req.data as any)?.accountId ?? req.query.accountId
  if (typeof qid === 'string' && qid.length > 0) return qid
  throw unauthorized()
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

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
        // Clear the state cookie now that we've consumed it.
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

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

export function projectRoutes(db: Db) {
  const r = Router()
  r.get   ('/',         parse(validate.projectList, 'query'), run(req => projectList(db, accountId(req), req.data)),                       send())
  r.post  ('/',         parse(validate.projectCreate),        run(req => projectCreate(db, accountId(req), req.data)),                     send(201))
  r.get   ('/:id',                                            run(req => projectGet(db, accountId(req), req.params.id)),                   send())
  r.put   ('/:id',      parse(validate.projectUpdate),        run(req => projectUpdate(db, accountId(req), req.params.id, req.data)),      send())
  r.get   ('/:id/tags',                                       run(req => projectTagList(db, accountId(req), req.params.id)),               send())
  r.post  ('/:id/run',                                        run(req => projectRun(db, accountId(req), req.params.id)),                   send(202))
  return r
}

export function analyticsRoutes(db: Db) {
  const r = Router()
  r.get('/', parse(validate.analytics, 'query'),
    run(req => analytics(db, accountId(req), req.data)), send())
  return r
}

export function connectionRoutes(db: Db) {
  const r = Router()
  // Provider metadata — drives UI form rendering and connection creation.
  // Lists every supported kind, its credential schema, and declared tool
  // names. No secrets, no handlers, safe to serve.
  r.get   ('/providers', run(() => providers.providerList().map(providers.providerMetadata)), send())
  r.get   ('/',    parse(validate.connectionList, 'query'), run(req => connectionList(db, accountIdOrQuery(req))),                              send())
  r.get   ('/:id',                                    run(req => connectionGet(db, accountId(req), req.params.id)),                send())
  r.post  ('/',    parse(validate.connectionCreate),  run(req => connectionCreate(db, accountId(req), req.data)),                  send(201))
  r.put   ('/:id', parse(validate.connectionUpdate),  run(req => connectionUpdate(db, accountId(req), req.params.id, req.data)),   send())
  r.delete('/:id',                                    run(req => connectionRemove(db, accountId(req), req.params.id)),             send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export function ticketRoutes(db: Db) {
  const r = Router()
  r.get   ('/',            parse(validate.ticketList, 'query'), run(req => ticketList(db, req.data)),                            send())
  r.post  ('/',            parse(validate.ticketCreate),        run(req => ticketCreate(db, req.data)),                          send(201))
  r.get   ('/:id',                                              run(req => ticketGet(db, req.params.id)),                        send())
  r.put   ('/:id',         parse(validate.ticketUpdate),        run(req => ticketUpdate(db, req.params.id, req.data)),           send())
  r.post  ('/:id/cancel',                                        run(req => ticketCancel(db, req.params.id)),                     send())
  r.get   ('/:id/chain',                                        run(req => ticketDependencyChain(db, req.params.id)),            send())
  r.get   ('/:id/verdict',                                      run(req => verdictList(db, req.params.id)),                      send())
  r.get   ('/:id/comment',                                      run(req => commentList(db, req.params.id)),                      send())
  r.post  ('/:id/comment', parse(validate.commentCreate),       run(req => commentCreate(db, req.params.id, req.data)),          send(201))
  r.get   ('/:id/session',                                      run(req => sessionByTicket(db, req.params.id)),                  send())
  r.get   ('/:id/usage',                                        run(req => ticketUsage(db, req.params.id)),                      send())
  r.get   ('/:id/tag',                                          run(req => tagList(db, req.params.id)),                           send())
  r.post  ('/:id/tag',              parse(validate.tagCreate),  run(req => tagAdd(db, req.params.id, req.data.tag)),              send(201))
  r.delete('/:id/tag/:tag',                                     run(req => tagRemove(db, req.params.id, req.params.tag)),         send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export function agentRoutes(db: Db, config: Config) {
  const r = Router()
  r.get   ('/tools',                                                            run(()  => [...TOOL_NAMES]),                                                            send())
  r.get   ('/mcp',                                                              run(req => agentMcpList(db, accountIdOrQuery(req))),                             send())
  r.get   ('/',                         parse(validate.agentList, 'query'),     run(req => agentList(db, { accountId: accountIdOrQuery(req) })),                  send())
  r.post  ('/',                         parse(validate.agentCreate),            run(req => agentCreate(db, accountId(req), req.data)),                            send(201))
  r.get   ('/:id',                                                              run(req => agentGet(db, req.params.id)),                                         send())
  r.get   ('/:id/usage',                                                        run(req => agentUsage(db, req.params.id)),                                       send())
  r.put   ('/:id',                      parse(validate.agentUpdate),            run(req => agentUpdate(db, accountId(req), req.params.id, req.data)),             send())
  r.delete('/:id',                                                              run(req => agentRemove(db, accountId(req), req.params.id)),                       send())
  r.get   ('/:id/session/:sid',                                                 run(req => sessionGet(db, req.params.sid)),                                      send())
  r.get   ('/:id/session/:sid/status',                                          run(req => sessionStatus(db, req.params.sid)),                                   send())
  r.delete('/:id/session/:sid',                                                 run(req => sessionKill(db, req.params.sid)),                                     send())
  r.get   ('/:id/session/:sid/activity',                                        run(req => sessionActivities(db, req.params.sid)),                               send())
  return r
}

export function sessionRoutes(db: Db) {
  const r = Router()
  r.get('/',               run(()  => sessionListAll(db)),                       send())
  r.get('/:id',            run(req => sessionGet(db, req.params.id)),            send())
  r.get('/:id/activity',   run(req => sessionActivities(db, req.params.id)),     send())
  r.get('/:id/execution',  run(req => executionBySession(db, req.params.id)),    send())
  r.get('/:id/usage',      run(req => sessionUsage(db, req.params.id)),          send())
  return r
}

export function executionRoutes(db: Db, config: Config) {
  const r = Router()
  r.get   ('/',           run(()  => executionList(db)),                                                                          send())
  r.post  ('/',           parse(validate.executionCreate), run(req => { const { id } = executionCreate(db, config, req.data); return { id } }), send(201))
  r.get   ('/:id',        run(req => executionGet(db, req.params.id)),                                                            send())
  r.delete('/:id',        run(req => executionKill(db, req.params.id)),                                                           send())
  r.get   ('/:id/output', (req, res, next) => { try { executionStream(db, req.params.id, res) } catch (e) { next(e) } })
  return r
}

