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
import { parseBody, parseQuery, sendResult, sendCreated, sendText, andThen, andThenAsync, asyncRoute } from './middleware.js'

// ── Tickets ──

export const listTickets = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseQuery(listTicketsQuery)(req), h.listTickets(db)))

export const createTicket = (db: Db) => (req: Request, res: Response) =>
  sendCreated(res)(andThen(parseBody(createTicketBody)(req), h.createTicket(db)))

export const getTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getTicket(db)(req.params.id))

export const updateTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseBody(updateTicketBody)(req), data => h.updateTicket(db)(req.params.id, data)))

export const claimTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.claimTicket(db)(req.params.id))

export const completeTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseBody(doneTicketBody)(req), data => h.completeTicket(db)(req.params.id, data.notes)))

export const failTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseBody(failTicketBody)(req), data => h.failTicket(db)(req.params.id, data.notes)))

export const reopenTicket = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.reopenTicket(db)(req.params.id))

export const getTicketChain = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getTicketChain(db)(req.params.id))

// ── Projects ──

export const listProjects = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseQuery(listProjectsQuery)(req), h.listProjects(db)))

export const createProject = (db: Db) => (req: Request, res: Response) =>
  sendCreated(res)(andThen(parseBody(createProjectBody)(req), h.createProject(db)))

export const getProject = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getProject(db)(req.params.id))

export const updateProject = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseBody(updateProjectBody)(req), data => h.updateProject(db)(req.params.id, data)))

export const runProject = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.runProject(db)(req.params.id))

// ── Agent Definitions ──

export const listAgentDefs = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseQuery(listAgentDefsQuery)(req), h.listAgentDefs(db)))

export const createAgentDef = (db: Db) => (req: Request, res: Response) =>
  sendCreated(res)(andThen(parseBody(createAgentDefBody)(req), h.createAgentDef(db)))

export const getAgentDef = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getAgentDef(db)(req.params.id))

export const updateAgentDef = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(andThen(parseBody(updateAgentDefBody)(req), data => h.updateAgentDef(db)(req.params.id, data)))

export const deleteAgentDef = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.deleteAgentDef(db)(req.params.id))

// ── Sessions ──

export const startSession = (db: Db, config: Config) => asyncRoute(async (req, res) =>
  sendCreated(res)(await andThenAsync(parseBody(startSessionBody)(req), data => h.startAgentSession(db, config)(req.params.id, data.ticket_id))))

export const getSession = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getSession(db)(req.params.sid))

export const getSessionStatus = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getSessionStatus(db)(req.params.sid))

export const killSession = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.killSession(db)(req.params.sid))

export const sendMessage = (db: Db) => (req: Request, res: Response) =>
  sendCreated(res)(andThen(parseBody(sendMessageBody)(req), data => h.insertMessage(db)(req.params.sid, 'founder', data.content)))

export const getMessages = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getMessages(db)(req.params.sid))

export const listAllSessions = (db: Db) => (_req: Request, res: Response) =>
  sendResult(res)(h.listAllSessions(db)())

// ── Files ──

export const listFiles = (config: Config) => asyncRoute(async (req, res) =>
  sendResult(res)(await h.gitListFiles(config.repoBase)(req.params.slug)))

export const readFile = (config: Config) => asyncRoute(async (req, res) =>
  sendText(res)(await h.gitReadFile(config.repoBase)(req.params.slug, req.params[0])))

export const writeFile = (config: Config) => asyncRoute(async (req, res) =>
  sendCreated(res)(await andThenAsync(parseBody(writeFileBody)(req), data =>
    h.gitWriteFile(config.repoBase)(req.params.slug, req.params[0], data.content, data.message ?? `update ${req.params[0]}`))))

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
  sendResult(res)(h.listSandboxRuns(db)())

export const createSandboxRun = (db: Db, config: Config) => (req: Request, res: Response) =>
  sendCreated(res)(andThen(parseBody(createSandboxBody)(req), data => {
    const result = h.createSandboxRun(db, config)(data)
    return result.ok ? { ok: true as const, data: { id: result.data.id } } : result
  }))

export const getSandboxRun = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.getSandboxRun(db)(req.params.id))

export const killSandboxRun = (db: Db) => (req: Request, res: Response) =>
  sendResult(res)(h.killSandboxRun(db)(req.params.id))

export const streamSandboxOutput = (db: Db) => (req: Request, res: Response) =>
  h.streamSandboxOutput(db)(req.params.id, res)
