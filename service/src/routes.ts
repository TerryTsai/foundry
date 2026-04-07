import type { Request, Response } from 'express'
// @ts-ignore — no types for node-git-server
import { Git as Server } from 'node-git-server'
import type { Db } from './db.js'
import type { Config } from './config.js'
import * as h from './helpers.js'
import {
  createTicketBody, updateTicketBody, doneTicketBody, failTicketBody, listTicketsQuery,
  createProjectBody, updateProjectBody, listProjectsQuery,
  createAgentDefBody, updateAgentDefBody, listAgentDefsQuery,
  startSessionBody, sendMessageBody,
  createSandboxBody, writeFileBody,
} from './validation.js'
import { parse, send, sendText, fail } from './middleware.js'

// ── Tickets ──

export const listTickets = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.query)
    .then(parse(listTicketsQuery))
    .then(h.listTickets(db))
    .then(send(res))
    .catch(fail(res))

export const createTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(createTicketBody))
    .then(h.createTicket(db))
    .then(send(res, 201))
    .catch(fail(res))

export const getTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.getTicket(db))
    .then(send(res))
    .catch(fail(res))

export const updateTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(updateTicketBody))
    .then(data => h.updateTicket(db)(req.params.id, data))
    .then(send(res))
    .catch(fail(res))

export const claimTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.claimTicket(db))
    .then(send(res))
    .catch(fail(res))

export const completeTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(doneTicketBody))
    .then(data => h.completeTicket(db)(req.params.id, data.notes))
    .then(send(res))
    .catch(fail(res))

export const failTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(failTicketBody))
    .then(data => h.failTicket(db)(req.params.id, data.notes))
    .then(send(res))
    .catch(fail(res))

export const reopenTicket = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.reopenTicket(db))
    .then(send(res))
    .catch(fail(res))

export const getTicketChain = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.getTicketChain(db))
    .then(send(res))
    .catch(fail(res))

// ── Projects ──

export const listProjects = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.query)
    .then(parse(listProjectsQuery))
    .then(h.listProjects(db))
    .then(send(res))
    .catch(fail(res))

export const createProject = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(createProjectBody))
    .then(h.createProject(db))
    .then(send(res, 201))
    .catch(fail(res))

export const getProject = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.getProject(db))
    .then(send(res))
    .catch(fail(res))

export const updateProject = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(updateProjectBody))
    .then(data => h.updateProject(db)(req.params.id, data))
    .then(send(res))
    .catch(fail(res))

export const runProject = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.runProject(db))
    .then(send(res, 202))
    .catch(fail(res))

// ── Agent Definitions ──

export const listAgentDefs = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.query)
    .then(parse(listAgentDefsQuery))
    .then(h.listAgentDefs(db))
    .then(send(res))
    .catch(fail(res))

export const createAgentDef = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(createAgentDefBody))
    .then(h.createAgentDef(db))
    .then(send(res, 201))
    .catch(fail(res))

export const getAgentDef = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.getAgentDef(db))
    .then(send(res))
    .catch(fail(res))

export const updateAgentDef = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(updateAgentDefBody))
    .then(data => h.updateAgentDef(db)(req.params.id, data))
    .then(send(res))
    .catch(fail(res))

export const deleteAgentDef = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.deleteAgentDef(db))
    .then(send(res))
    .catch(fail(res))

// ── Sessions ──

export const startSession = (db: Db, config: Config) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(startSessionBody))
    .then(data => h.startAgentSession(db, config)(req.params.id, data.ticket_id))
    .then(send(res, 201))
    .catch(fail(res))

export const getSession = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.sid)
    .then(h.getSession(db))
    .then(send(res))
    .catch(fail(res))

export const getSessionStatus = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.sid)
    .then(h.getSessionStatus(db))
    .then(send(res))
    .catch(fail(res))

export const killSession = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.sid)
    .then(h.killSession(db))
    .then(send(res))
    .catch(fail(res))

export const sendMessage = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(sendMessageBody))
    .then(data => h.insertMessage(db)(req.params.sid, 'founder', data.content))
    .then(send(res, 201))
    .catch(fail(res))

export const getMessages = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.sid)
    .then(h.getMessages(db))
    .then(send(res))
    .catch(fail(res))

export const listAllSessions = (db: Db) => (_req: Request, res: Response) =>
  Promise.resolve()
    .then(h.listAllSessions(db))
    .then(send(res))
    .catch(fail(res))

// ── Files ──

export const listFiles = (config: Config) => (req: Request, res: Response) =>
  Promise.resolve(req.params.slug)
    .then(h.gitListFiles(config.repoBase))
    .then(send(res))
    .catch(fail(res))

export const readFile = (config: Config) => (req: Request, res: Response) =>
  Promise.resolve(req.params.slug)
    .then(slug => h.gitReadFile(config.repoBase)(slug, req.params[0]))
    .then(sendText(res))
    .catch(fail(res))

export const writeFile = (config: Config) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(writeFileBody))
    .then(data => h.gitWriteFile(config.repoBase)(req.params.slug, req.params[0], data.content, data.message ?? `update ${req.params[0]}`))
    .then(send(res, 201))
    .catch(fail(res))

export const gitWireProtocol = (config: Config) => {
  const repos = new Server(config.repoBase, { autoCreate: false })
  repos.on('push', (push: { accept: () => void }) => push.accept())
  repos.on('fetch', (fetch: { accept: () => void }) => fetch.accept())
  repos.on('info', (info: { accept: () => void }) => info.accept())

  return (req: Request, res: Response) => {
    req.url = req.url.replace(/^\/git/, '')
    repos.handle(req, res)
  }
}

// ── Sandbox ──

export const listSandboxRuns = (db: Db) => (_req: Request, res: Response) =>
  Promise.resolve()
    .then(h.listSandboxRuns(db))
    .then(send(res))
    .catch(fail(res))

export const createSandboxRun = (db: Db, config: Config) => (req: Request, res: Response) =>
  Promise.resolve(req.body)
    .then(parse(createSandboxBody))
    .then(data => h.createSandboxRun(db, config)(data))
    .then(({ id }) => ({ id }))
    .then(send(res, 201))
    .catch(fail(res))

export const getSandboxRun = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.getSandboxRun(db))
    .then(send(res))
    .catch(fail(res))

export const killSandboxRun = (db: Db) => (req: Request, res: Response) =>
  Promise.resolve(req.params.id)
    .then(h.killSandboxRun(db))
    .then(send(res))
    .catch(fail(res))

export const streamSandboxOutput = (db: Db) => (req: Request, res: Response) => {
  try {
    h.streamSandboxOutput(db)(req.params.id, res)
  } catch (err) {
    fail(res)(err)
  }
}
