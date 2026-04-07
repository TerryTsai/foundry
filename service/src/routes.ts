import { Router, type Request, type Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'
import type { Db } from './db.js'
import type { Config } from './config.js'
import * as h from './handlers.js'
import * as v from './validate.js'
import { body, query, handle, send, sendText } from './middleware.js'

// ── Tickets ──

export const ticket = (db: Db) => {
  const r = Router()
  r.get   ('/',            query(v.ticket.list), handle(req => h.ticket.list(db)(req.data)),                       send())
  r.post  ('/',            body(v.ticket.create), handle(req => h.ticket.create(db)(req.data)),                    send(201))
  r.get   ('/:id',         handle(req => h.ticket.get(db)(req.params.id)),                                        send())
  r.put   ('/:id',         body(v.ticket.update), handle(req => h.ticket.update(db)(req.params.id, req.data)),     send())
  r.post  ('/:id/claim',   handle(req => h.ticket.claim(db)(req.params.id)),                                      send())
  r.post  ('/:id/done',    body(v.ticket.done), handle(req => h.ticket.complete(db)(req.params.id, req.data.notes)), send())
  r.post  ('/:id/fail',    body(v.ticket.fail), handle(req => h.ticket.fail(db)(req.params.id, req.data.notes)),   send())
  r.post  ('/:id/reopen',  handle(req => h.ticket.reopen(db)(req.params.id)),                                     send())
  r.get   ('/:id/chain',   handle(req => h.ticket.chain(db)(req.params.id)),                                      send())
  return r
}

// ── Projects ──

export const project = (db: Db) => {
  const r = Router()
  r.get   ('/',         query(v.project.list), handle(req => h.project.list(db)(req.data)),                       send())
  r.post  ('/',         body(v.project.create), handle(req => h.project.create(db)(req.data)),                    send(201))
  r.get   ('/:id',      handle(req => h.project.get(db)(req.params.id)),                                         send())
  r.put   ('/:id',      body(v.project.update), handle(req => h.project.update(db)(req.params.id, req.data)),     send())
  r.post  ('/:id/run',  handle(req => h.project.run(db)(req.params.id)),                                         send(202))
  return r
}

// ── Agent Definitions + Sessions ──

export const agent = (db: Db, config: Config) => {
  const r = Router()
  r.get   ('/',                       query(v.agent.list), handle(req => h.agent.list(db)(req.data)),                       send())
  r.post  ('/',                       body(v.agent.create), handle(req => h.agent.create(db)(req.data)),                    send(201))
  r.get   ('/:id',                    handle(req => h.agent.get(db)(req.params.id)),                                        send())
  r.put   ('/:id',                    body(v.agent.update), handle(req => h.agent.update(db)(req.params.id, req.data)),     send())
  r.delete('/:id',                    handle(req => h.agent.remove(db)(req.params.id)),                                     send())
  r.post  ('/:id/session',            body(v.session.start), handle(req => h.session.start(db, config)(req.params.id, req.data.ticket_id)), send(201))
  r.get   ('/:id/session/:sid',       handle(req => h.session.get(db)(req.params.sid)),                                     send())
  r.get   ('/:id/session/:sid/status', handle(req => h.session.status(db)(req.params.sid)),                                 send())
  r.delete('/:id/session/:sid',       handle(req => h.session.kill(db)(req.params.sid)),                                    send())
  r.post  ('/:id/session/:sid/message', body(v.session.message), handle(req => h.session.message(db)(req.params.sid, 'founder', req.data.content)), send(201))
  r.get   ('/:id/session/:sid/message', handle(req => h.session.messages(db)(req.params.sid)),                              send())
  return r
}

// ── Sessions (top-level) ──

export const session = (db: Db) => {
  const r = Router()
  r.get('/', handle(() => h.session.listAll(db)()), send())
  return r
}

// ── Files ──

export const file = (config: Config) => {
  const r = Router({ mergeParams: true })
  r.get ('/:slug',   handle(req => h.file.list(config.repoBase)(req.params.slug)),                                                               send())
  r.get ('/:slug/*', handle(req => h.file.read(config.repoBase)(req.params.slug, req.params[0])),                                                sendText)
  r.post('/:slug/*', body(v.file.write), handle(req => h.file.write(config.repoBase)(req.params.slug, req.params[0], req.data.content, req.data.message ?? `update ${req.params[0]}`)), send(201))
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

export const sandbox = (db: Db, config: Config) => {
  const r = Router()
  r.get   ('/',           handle(() => h.sandbox.list(db)()),                                                     send())
  r.post  ('/',           body(v.sandbox.create), handle(req => { const { id } = h.sandbox.create(db, config)(req.data); return { id } }), send(201))
  r.get   ('/:id',        handle(req => h.sandbox.get(db)(req.params.id)),                                        send())
  r.delete('/:id',        handle(req => h.sandbox.kill(db)(req.params.id)),                                       send())
  r.get   ('/:id/output', (req, res, next) => { try { h.sandbox.stream(db)(req.params.id, res) } catch (e) { next(e) } })
  return r
}
