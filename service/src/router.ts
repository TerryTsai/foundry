import { Router, type Request, type Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'
import type { Db } from './database.js'
import type { Config } from './config.js'
import domain from './domain.js'
import * as v from './validate.js'
import { slugify } from './functional.js'
import { parse, run, send, sendText } from './middleware.js'
import { TOOL_NAMES } from './tool.js'

// ════════════════════════════════════════════════════════════════════════════
// PROJECT
// ════════════════════════════════════════════════════════════════════════════

export const project = (db: Db, config: Config) => {
  const r = Router()
  r.get   ('/',         parse(v.project.list, 'query'), run(req => domain.project.list(db)(req.data)),                         send())
  r.post  ('/',         parse(v.project.create),        run(req => domain.project.create(db, config)(req.data)),               send(201))
  r.get   ('/:id',                                      run(req => domain.project.get(db)(req.params.id)),                     send())
  r.put   ('/:id',      parse(v.project.update),        run(req => domain.project.update(db)(req.params.id, req.data)),        send())
  r.post  ('/:id/run',                                  run(req => domain.project.run(db)(req.params.id)),                     send(202))
  return r
}

export const provider = (db: Db) => {
  const r = Router()
  r.get   ('/',    run(() => domain.provider.list(db)()),                                          send())
  r.post  ('/',    parse(v.provider.create), run(req => domain.provider.create(db)(req.data)),     send(201))
  r.put   ('/:id', parse(v.provider.update), run(req => domain.provider.update(db)(req.params.id, req.data)), send())
  r.delete('/:id',                           run(req => domain.provider.remove(db)(req.params.id)), send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// TICKETING
// ════════════════════════════════════════════════════════════════════════════

export const ticket = (db: Db) => {
  const r = Router()
  r.get   ('/',            parse(v.ticket.list, 'query'), run(req => domain.ticket.list(db)(req.data)),                            send())
  r.post  ('/',            parse(v.ticket.create),        run(req => domain.ticket.create(db)(req.data)),                          send(201))
  r.get   ('/:id',                                        run(req => domain.ticket.get(db)(req.params.id)),                        send())
  r.put   ('/:id',         parse(v.ticket.update),        run(req => domain.ticket.update(db)(req.params.id, req.data)),           send())
  r.post  ('/:id/claim',                                  run(req => domain.ticket.claim(db)(req.params.id)),                      send())
  r.post  ('/:id/done',    parse(v.ticket.done),          run(req => domain.ticket.complete(db)(req.params.id, req.data.notes)),   send())
  r.post  ('/:id/fail',    parse(v.ticket.fail),          run(req => domain.ticket.fail(db)(req.params.id, req.data.notes)),       send())
  r.post  ('/:id/reopen',                                 run(req => domain.ticket.reopen(db)(req.params.id)),                     send())
  r.get   ('/:id/chain',                                  run(req => domain.ticket.chain(db)(req.params.id)),                      send())
  r.get   ('/:id/comment',                                run(req => domain.comment.list(db)(req.params.id)),                      send())
  r.post  ('/:id/comment', parse(v.comment.create),       run(req => domain.comment.create(db)(req.params.id, req.data)),          send(201))
  r.get   ('/:id/session',                                run(req => domain.session.byTicket(db)(req.params.id)),                   send())
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT
// ════════════════════════════════════════════════════════════════════════════

export const agent = (db: Db, config: Config) => {
  const r = Router()
  r.get   ('/tools',                                                   run(() => [...TOOL_NAMES]),                                                        send())
  r.get   ('/',                         parse(v.agent.list, 'query'),  run(req => domain.agent.list(db)(req.data)),                                       send())
  r.post  ('/',                         parse(v.agent.create),         run(req => domain.agent.create(db)(req.data)),                                     send(201))
  r.get   ('/:id',                                                     run(req => domain.agent.get(db)(req.params.id)),                                   send())
  r.put   ('/:id',                      parse(v.agent.update),         run(req => domain.agent.update(db)(req.params.id, req.data)),                      send())
  r.delete('/:id',                                                     run(req => domain.agent.remove(db)(req.params.id)),                                send())
  r.post  ('/:id/session',              parse(v.session.start),        run(req => domain.session.start(db, config)(req.params.id, req.data.ticket_id)),    send(201))
  r.get   ('/:id/session/:sid',                                        run(req => domain.session.get(db)(req.params.sid)),                                 send())
  r.get   ('/:id/session/:sid/status',                                 run(req => domain.session.status(db)(req.params.sid)),                              send())
  r.delete('/:id/session/:sid',                                        run(req => domain.session.kill(db)(req.params.sid)),                                send())
  r.post  ('/:id/session/:sid/message', parse(v.session.message),      run(req => domain.session.message(db)(req.params.sid, 'founder', req.data.content)), send(201))
  r.get   ('/:id/session/:sid/message',                                run(req => domain.session.messages(db)(req.params.sid)),                            send())
  return r
}

export const session = (db: Db) => {
  const r = Router()
  r.get('/',                run(() => domain.session.listAll(db)()),                          send())
  r.get('/:id',            run(req => domain.session.get(db)(req.params.id)),                 send())
  r.get('/:id/message',    run(req => domain.session.messages(db)(req.params.id)),           send())
  r.get('/:id/execution',  run(req => domain.execution.bySession(db)(req.params.id)),        send())
  return r
}

export const execution = (db: Db, config: Config) => {
  const r = Router()
  r.get   ('/',           run(() => domain.execution.list(db)()),                                                                   send())
  r.post  ('/',           parse(v.execution.create), run(req => { const { id } = domain.execution.create(db, config)(req.data); return { id } }), send(201))
  r.get   ('/:id',        run(req => domain.execution.get(db)(req.params.id)),                                                      send())
  r.delete('/:id',        run(req => domain.execution.kill(db)(req.params.id)),                                                     send())
  r.get   ('/:id/output', (req, res, next) => { try { domain.execution.stream(db)(req.params.id, res) } catch (e) { next(e) } })
  return r
}

// ════════════════════════════════════════════════════════════════════════════
// FILES
// ════════════════════════════════════════════════════════════════════════════

export const file = (config: Config, db: Db) => {
  const r = Router({ mergeParams: true })
  r.get ('/:id',   run(req => { const p = domain.project.get(db)(req.params.id); return domain.file.list(config.repoBase)(slugify(p.name)) }),   send())
  r.get ('/:id/*', run(req => { const p = domain.project.get(db)(req.params.id); return domain.file.read(config.repoBase)(slugify(p.name), req.params[0]) }), sendText)
  r.post('/:id/*', parse(v.file.write), run(req => { const p = domain.project.get(db)(req.params.id); return domain.file.write(config.repoBase)(slugify(p.name), req.params[0], req.data.content, req.data.message ?? `update ${req.params[0]}`) }), send(201))
  return r
}

export const git = (config: Config) => {
  const repos = new Server(config.repoBase, { autoCreate: false })
  repos.on('push', (push: { accept: () => void }) => push.accept())
  repos.on('fetch', (fetch: { accept: () => void }) => fetch.accept())
  repos.on('info', (info: { accept: () => void }) => info.accept())

  const r = Router()
  r.all('/:slug\\.git*', (req: Request, res: Response) => {
    req.url = req.url.replace(/^\/git/, '')
    repos.handle(req, res)
  })
  return r
}
