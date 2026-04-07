import express from 'express'
import { config } from './config.js'
import { createDb } from './db.js'
import * as routes from './routes.js'
import { recoverStalledTickets, startAllSchedulers } from './helpers.js'

const db  = createDb(config.dbPath)
const app = express()

app.use(express.json())

// ── Tickets ──
app.get   ('/ticket',              routes.listTickets(db))
app.post  ('/ticket',              routes.createTicket(db))
app.get   ('/ticket/:id',          routes.getTicket(db))
app.put   ('/ticket/:id',          routes.updateTicket(db))
app.post  ('/ticket/:id/claim',    routes.claimTicket(db))
app.post  ('/ticket/:id/done',     routes.completeTicket(db))
app.post  ('/ticket/:id/fail',     routes.failTicket(db))
app.post  ('/ticket/:id/reopen',   routes.reopenTicket(db))
app.get   ('/ticket/:id/chain',    routes.getTicketChain(db))

// ── Projects ──
app.get   ('/project',             routes.listProjects(db))
app.post  ('/project',             routes.createProject(db))
app.get   ('/project/:id',         routes.getProject(db))
app.put   ('/project/:id',         routes.updateProject(db))
app.post  ('/project/:id/run',     routes.runProject(db))

// ── Agent Definitions ──
app.get   ('/agent',               routes.listAgentDefs(db))
app.post  ('/agent',               routes.createAgentDef(db))
app.get   ('/agent/:id',           routes.getAgentDef(db))
app.put   ('/agent/:id',           routes.updateAgentDef(db))
app.delete('/agent/:id',           routes.deleteAgentDef(db))

// ── Sessions ──
app.post  ('/agent/:id/session',              routes.startSession(db, config))
app.get   ('/agent/:id/session/:sid',         routes.getSession(db))
app.get   ('/agent/:id/session/:sid/status',  routes.getSessionStatus(db))
app.delete('/agent/:id/session/:sid',         routes.killSession(db))
app.post  ('/agent/:id/session/:sid/message', routes.sendMessage(db))
app.get   ('/agent/:id/session/:sid/message', routes.getMessages(db))
app.get   ('/session',                        routes.listAllSessions(db))

// ── Files ──
app.get   ('/file/:slug',          routes.listFiles(config))
app.get   ('/file/:slug/*',        routes.readFile(config))
app.post  ('/file/:slug/*',        routes.writeFile(config))
app.all   ('/git/:slug\\.git*',    routes.gitWireProtocol(config))

// ── Sandbox ──
app.get   ('/sandbox',             routes.listSandboxRuns(db))
app.post  ('/sandbox',             routes.createSandboxRun(db, config))
app.get   ('/sandbox/:id',         routes.getSandboxRun(db))
app.delete('/sandbox/:id',         routes.killSandboxRun(db))
app.get   ('/sandbox/:id/output',  routes.streamSandboxOutput(db))

// ── Health ──
app.get   ('/health',              (_req, res) => res.json({ ok: true }))

app.listen(config.port, () => {
  console.log(`foundry service listening on port ${config.port}`)
  recoverStalledTickets(db)().catch(console.error)
  startAllSchedulers(db)()
})

export { app }
