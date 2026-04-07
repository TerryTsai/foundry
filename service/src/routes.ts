import { Router, type Request, type Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'
import type { Database } from './database.js'
import type { Config } from './config.js'
import * as d from './domain.js'
import * as v from './validate.js'
import { parse, run, send, sendText } from './middleware.js'

// ── Tickets ──

export const ticket = (db: Database) => {
  const r = Router()
  r.get   ('/',            parse(v.ticket.list, 'query'), run(req => d.ticket.list(db)(req.data)),                       send())
  r.post  ('/',            parse(v.ticket.create),        run(req => d.ticket.create(db)(req.data)),                     send(201))
  r.get   ('/:id',                                        run(req => d.ticket.get(db)(req.params.id)),                   send())
  r.put   ('/:id',         parse(v.ticket.update),        run(req => d.ticket.update(db)(req.params.id, req.data)),      send())
  r.post  ('/:id/claim',                                  run(req => d.ticket.claim(db)(req.params.id)),                 send())
  r.post  ('/:id/done',    parse(v.ticket.done),          run(req => d.ticket.complete(db)(req.params.id, req.data.notes)), send())
  r.post  ('/:id/fail',    parse(v.ticket.fail),          run(req => d.ticket.fail(db)(req.params.id, req.data.notes)),  send())
  r.post  ('/:id/reopen',                                 run(req => d.ticket.reopen(db)(req.params.id)),                send())
  r.get   ('/:id/chain',                                  run(req => d.ticket.chain(db)(req.params.id)),                 send())
  return r
}

// ── Projects ──

export const project = (db: Database) => {
  const r = Router()
  r.get   ('/',         parse(v.project.list, 'query'), run(req => d.project.list(db)(req.data)),                       send())
  r.post  ('/',         parse(v.project.create),        run(req => d.project.create(db)(req.data)),                     send(201))
  r.get   ('/:id',                                      run(req => d.project.get(db)(req.params.id)),                   send())
  r.put   ('/:id',      parse(v.project.update),        run(req => d.project.update(db)(req.params.id, req.data)),      send())
  r.post  ('/:id/run',                                  run(req => d.project.run(db)(req.params.id)),                   send(202))
  return r
}

// ── Agent Definitions + Sessions ──

export const agent = (db: Database, config: Config) => {
  const r = Router()
  r.get   ('/',                         parse(v.agent.list, 'query'), run(req => d.agent.list(db)(req.data)),                              send())
  r.post  ('/',                         parse(v.agent.create),        run(req => d.agent.create(db)(req.data)),                            send(201))
  r.get   ('/:id',                                                    run(req => d.agent.get(db)(req.params.id)),                          send())
  r.put   ('/:id',                      parse(v.agent.update),        run(req => d.agent.update(db)(req.params.id, req.data)),             send())
  r.delete('/:id',                                                    run(req => d.agent.remove(db)(req.params.id)),                       send())
  r.post  ('/:id/session',              parse(v.session.start),       run(req => d.session.start(db, config)(req.params.id, req.data.ticket_id)), send(201))
  r.get   ('/:id/session/:sid',                                       run(req => d.session.get(db)(req.params.sid)),                       send())
  r.get   ('/:id/session/:sid/status',                                run(req => d.session.status(db)(req.params.sid)),                    send())
  r.delete('/:id/session/:sid',                                       run(req => d.session.kill(db)(req.params.sid)),                      send())
  r.post  ('/:id/session/:sid/message', parse(v.session.message),     run(req => d.session.message(db)(req.params.sid, 'founder', req.data.content)), send(201))
  r.get   ('/:id/session/:sid/message',                               run(req => d.session.messages(db)(req.params.sid)),                  send())
  return r
}

// ── Sessions (top-level) ──

export const session = (db: Database) => {
  const r = Router()
  r.get('/', run(() => d.session.listAll(db)()), send())
  return r
}

// ── Files ──

export const file = (config: Config) => {
  const r = Router({ mergeParams: true })
  r.get ('/:slug',   run(req => d.file.list(config.repoBase)(req.params.slug)),   send())
  r.get ('/:slug/*', run(req => d.file.read(config.repoBase)(req.params.slug, req.params[0])), sendText)
  r.post('/:slug/*', parse(v.file.write), run(req => d.file.write(config.repoBase)(req.params.slug, req.params[0], req.data.content, req.data.message ?? `update ${req.params[0]}`)), send(201))
  return r
}

// ── Git Wire Protocol ──

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

// ── Sandbox ──

export const sandbox = (db: Database, config: Config) => {
  const r = Router()
  r.get   ('/',           run(() => d.sandbox.list(db)()),                                                                send())
  r.post  ('/',           parse(v.sandbox.create), run(req => { const { id } = d.sandbox.create(db, config)(req.data); return { id } }), send(201))
  r.get   ('/:id',        run(req => d.sandbox.get(db)(req.params.id)),                                                   send())
  r.delete('/:id',        run(req => d.sandbox.kill(db)(req.params.id)),                                                  send())
  r.get   ('/:id/output', (req, res, next) => { try { d.sandbox.stream(db)(req.params.id, res) } catch (e) { next(e) } })
  return r
}
