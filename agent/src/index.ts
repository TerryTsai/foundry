import express from 'express'
import { eq } from 'drizzle-orm'
import { createDb } from './db/client.js'
import { agentSessions, agentDefinitions } from './db/schema.js'
import { definitionsRouter } from './routes/definitions.js'
import { sessionsRouter } from './routes/sessions.js'
import { runAgentSession } from './session.js'

const port = parseInt(process.env.AGENT_PORT ?? '3005', 10)
const dbPath = process.env.DB_PATH ?? './agent.db'

const ticketUrl = process.env.TICKET_URL ?? 'http://localhost:3002'
const sandboxUrl = process.env.SANDBOX_URL ?? 'http://localhost:3004'
const repoUrl = process.env.REPO_URL ?? 'http://localhost:3003'

const { db } = createDb(dbPath)
const deps = { ticketUrl, sandboxUrl, repoUrl }

const app = express()
app.use(express.json())

app.use('/agent', definitionsRouter(db))
app.use('/agent/:id/session', sessionsRouter(db, deps, runAgentSession))

// GET /session — all sessions across all agents (for logs view)
app.get('/session', (_req, res) => {
  const rows = db.select({
    id: agentSessions.id,
    ticket_id: agentSessions.ticket_id,
    agent_def_id: agentSessions.agent_def_id,
    agent_name: agentDefinitions.name,
    status: agentSessions.status,
    started_at: agentSessions.started_at,
    ended_at: agentSessions.ended_at,
  })
  .from(agentSessions)
  .leftJoin(agentDefinitions, eq(agentSessions.agent_def_id, agentDefinitions.id))
  .orderBy(agentSessions.started_at)
  .all()
  .reverse()
  .slice(0, 200)
  res.json(rows)
})

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`agent service listening on port ${port}`)
})

export { app }
