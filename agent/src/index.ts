import express from 'express'
import { createDb } from './db/client.js'
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

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`agent service listening on port ${port}`)
})

export { app }
