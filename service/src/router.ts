import { Router, type Request, type Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'
import type { Db } from './database.js'
import type { Config } from './config.js'
import * as domain from './domain.js'
import * as validate from './validate.js'
import { slugify } from './functional.js'
import { parse, run, send, sendText } from './middleware.js'
import { TOOL_NAMES } from './runtime/tool.js'

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

export function project(db: Db, config: Config) {
  const r = Router()
  r.get   ('/',         parse(validate.projectList, 'query'), run(req => domain.projectList(db, req.data)),                          send())
  r.post  ('/',         parse(validate.projectCreate),        run(req => domain.projectCreate(db, config, req.data)),                send(201))
  r.get   ('/:id',                                            run(req => domain.projectGet(db, req.params.id)),                     send())
  r.put   ('/:id',      parse(validate.projectUpdate),        run(req => domain.projectUpdate(db, req.params.id, req.data)),        send())
  r.post  ('/:id/run',                                        run(req => domain.projectRun(db, req.params.id)),                     send(202))
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

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

export function file(config: Config, db: Db) {
  const r = Router({ mergeParams: true })
  r.get ('/:id',   run(req => { const p = domain.projectGet(db, req.params.id); return domain.fileList(config.repoBase, slugify(p.name)) }),   send())
  r.get ('/:id/*', run(req => { const p = domain.projectGet(db, req.params.id); return domain.fileRead(config.repoBase, slugify(p.name), req.params[0]) }), sendText)
  r.post('/:id/*', parse(validate.fileWrite), run(req => { const p = domain.projectGet(db, req.params.id); return domain.fileWrite(config.repoBase, slugify(p.name), req.params[0], req.data.content, req.data.message ?? `update ${req.params[0]}`) }), send(201))
  return r
}

export function git(config: Config) {
  const repos = new Server(config.repoBase, { autoCreate: false })
  repos.on('push',  (push: { accept: () => void })  => push.accept())
  repos.on('fetch', (fetch: { accept: () => void }) => fetch.accept())
  repos.on('info',  (info: { accept: () => void })  => info.accept())

  const r = Router()
  r.all('/:slug\\.git*', (req: Request, res: Response) => {
    req.url = req.url.replace(/^\/git/, '')
    repos.handle(req, res)
  })
  return r
}
