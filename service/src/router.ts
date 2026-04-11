import { Router, type Request } from 'express'
import type { Db } from './database.js'
import type { Config } from './config.js'
import * as domain from './domain.js'
import * as validate from './validate.js'
import { AppError } from './functional.js'
import { parse, run, send, parseCookie, serializeCookie, requireAuth } from './middleware.js'
import { TOOL_NAMES } from './mcp/registry.js'

// Each project handler resolves the caller's account from req (set by
// requireAuth) and forwards it to the domain layer for ownership checks.
function accountId(req: Request): string {
  if (!req.account) throw new AppError(401, 'unauthorized')
  return req.account.id
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

export function auth(db: Db, config: Config) {
  const r = Router()

  // Begin OAuth: stash a random `state` in a short-lived cookie, redirect to GitHub.
  r.get('/github', (req, res) => {
    const { url, state } = domain.authStart(config, requestBaseUrl(req))
    res.setHeader('Set-Cookie', serializeCookie('oauth_state', state, {
      maxAge: domain.AUTH_STATE_TTL_SEC, secure: config.cookieSecure, sameSite: 'Lax',
    }))
    res.redirect(302, url)
  })

  // OAuth callback: validate state, exchange code, upsert account, mint session.
  r.get('/github/callback', parse(validate.authCallback, 'query'), async (req, res, next) => {
    try {
      const stateCookie = parseCookie(req.headers.cookie, 'oauth_state')
      const { sessionId, expiresAt } = await domain.authCallback(db, config, req.data, stateCookie)
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

  r.get('/me', requireAuth(db), (req, res) => {
    res.json(domain.authMe(req.account!))
  })

  r.post('/logout', (req, res) => {
    const sid = parseCookie(req.headers.cookie, 'foundry_session')
    if (sid) domain.authLogout(db, sid)
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

export function project(db: Db) {
  const r = Router()
  r.get   ('/',         parse(validate.projectList, 'query'), run(req => domain.projectList(db, accountId(req), req.data)),                       send())
  r.post  ('/',         parse(validate.projectCreate),        run(req => domain.projectCreate(db, accountId(req), req.data)),                     send(201))
  r.get   ('/:id',                                            run(req => domain.projectGet(db, accountId(req), req.params.id)),                   send())
  r.put   ('/:id',      parse(validate.projectUpdate),        run(req => domain.projectUpdate(db, accountId(req), req.params.id, req.data)),      send())
  r.post  ('/:id/run',                                        run(req => domain.projectRun(db, accountId(req), req.params.id)),                   send(202))
  return r
}

export function provider(db: Db) {
  const r = Router()
  r.get   ('/',                                       run(()  => domain.providerList(db)),                              send())
  r.post  ('/',    parse(validate.providerCreate),    run(req => domain.providerCreate(db, req.data)),                  send(201))
  r.put   ('/:id', parse(validate.providerUpdate),    run(req => domain.providerUpdate(db, req.params.id, req.data)),   send())
  r.delete('/:id',                                    run(req => domain.providerRemove(db, req.params.id)),             send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export function ticket(db: Db) {
  const r = Router()
  r.get   ('/',            parse(validate.ticketList, 'query'), run(req => domain.ticketList(db, req.data)),                            send())
  r.post  ('/',            parse(validate.ticketCreate),        run(req => domain.ticketCreate(db, req.data)),                          send(201))
  r.get   ('/:id',                                              run(req => domain.ticketGet(db, req.params.id)),                        send())
  r.put   ('/:id',         parse(validate.ticketUpdate),        run(req => domain.ticketUpdate(db, req.params.id, req.data)),           send())
  r.post  ('/:id/claim',                                        run(req => domain.ticketClaim(db, req.params.id)),                      send())
  r.post  ('/:id/done',    parse(validate.ticketDone),          run(req => domain.ticketComplete(db, req.params.id, req.data.notes)),   send())
  r.post  ('/:id/fail',    parse(validate.ticketFail),          run(req => domain.ticketFail(db, req.params.id, req.data.notes)),       send())
  r.post  ('/:id/reopen',                                       run(req => domain.ticketReopen(db, req.params.id)),                     send())
  r.get   ('/:id/chain',                                        run(req => domain.ticketChain(db, req.params.id)),                      send())
  r.get   ('/:id/comment',                                      run(req => domain.commentList(db, req.params.id)),                      send())
  r.post  ('/:id/comment', parse(validate.commentCreate),       run(req => domain.commentCreate(db, req.params.id, req.data)),          send(201))
  r.get   ('/:id/session',                                      run(req => domain.sessionByTicket(db, req.params.id)),                  send())
  r.get   ('/:id/usage',                                        run(req => domain.ticketUsage(db, req.params.id)),                      send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export function agent(db: Db, config: Config) {
  const r = Router()
  r.get   ('/tools',                                                            run(()  => [...TOOL_NAMES]),                                                            send())
  r.get   ('/',                         parse(validate.agentList, 'query'),     run(req => domain.agentList(db, req.data)),                                             send())
  r.post  ('/',                         parse(validate.agentCreate),            run(req => domain.agentCreate(db, req.data)),                                           send(201))
  r.get   ('/:id',                                                              run(req => domain.agentGet(db, req.params.id)),                                         send())
  r.get   ('/:id/usage',                                                        run(req => domain.agentUsage(db, req.params.id)),                                       send())
  r.put   ('/:id',                      parse(validate.agentUpdate),            run(req => domain.agentUpdate(db, req.params.id, req.data)),                            send())
  r.delete('/:id',                                                              run(req => domain.agentRemove(db, req.params.id)),                                      send())
  r.post  ('/:id/session',              parse(validate.sessionStart),           run(req => domain.sessionStart(db, config, req.params.id, req.data.ticket_id)),         send(201))
  r.get   ('/:id/session/:sid',                                                 run(req => domain.sessionGet(db, req.params.sid)),                                      send())
  r.get   ('/:id/session/:sid/status',                                          run(req => domain.sessionStatus(db, req.params.sid)),                                   send())
  r.delete('/:id/session/:sid',                                                 run(req => domain.sessionKill(db, req.params.sid)),                                     send())
  r.post  ('/:id/session/:sid/message', parse(validate.sessionMessage),         run(req => domain.sessionMessage(db, req.params.sid, 'founder', req.data.content)),     send(201))
  r.get   ('/:id/session/:sid/message',                                         run(req => domain.sessionMessages(db, req.params.sid)),                                 send())
  return r
}

export function session(db: Db) {
  const r = Router()
  r.get('/',               run(()  => domain.sessionListAll(db)),                       send())
  r.get('/:id',            run(req => domain.sessionGet(db, req.params.id)),            send())
  r.get('/:id/message',    run(req => domain.sessionMessages(db, req.params.id)),       send())
  r.get('/:id/execution',  run(req => domain.executionBySession(db, req.params.id)),    send())
  r.get('/:id/usage',      run(req => domain.sessionUsage(db, req.params.id)),          send())
  return r
}

export function execution(db: Db, config: Config) {
  const r = Router()
  r.get   ('/',           run(()  => domain.executionList(db)),                                                                          send())
  r.post  ('/',           parse(validate.executionCreate), run(req => { const { id } = domain.executionCreate(db, config, req.data); return { id } }), send(201))
  r.get   ('/:id',        run(req => domain.executionGet(db, req.params.id)),                                                            send())
  r.delete('/:id',        run(req => domain.executionKill(db, req.params.id)),                                                           send())
  r.get   ('/:id/output', (req, res, next) => { try { domain.executionStream(db, req.params.id, res) } catch (e) { next(e) } })
  return r
}

