import express from 'express'
import { createDb } from './db/client.js'
import { projectRouter } from './routes/projects.js'
import {
  dispatch,
  recoverStalledTickets,
  startAllSchedulers,
  scheduleProject,
  clearProjectSchedule,
} from './scheduler.js'

const port = parseInt(process.env.PROJECT_PORT ?? '3001', 10)
const dbPath = process.env.DB_PATH ?? './project.db'

const ticketUrl = process.env.TICKET_URL ?? 'http://localhost:3002'
const agentUrl = process.env.AGENT_URL ?? 'http://localhost:3005'
const deps = { ticketUrl, agentUrl }

const { db } = createDb(dbPath)

const app = express()
app.use(express.json())

app.use('/project', projectRouter(db, {
  async triggerDispatch(projectId: string) {
    await dispatch(db, projectId, deps)
  },
  onProjectCreated(projectId: string, intervalSeconds: number) {
    scheduleProject(db, projectId, intervalSeconds, deps)
  },
  onProjectPaused(projectId: string) {
    clearProjectSchedule(projectId)
  },
  onProjectResumed(projectId: string, intervalSeconds: number) {
    scheduleProject(db, projectId, intervalSeconds, deps)
  },
}))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, async () => {
  console.log(`project service listening on port ${port}`)
  // Recover stalled tickets from a previous crash
  await recoverStalledTickets(db, deps).catch(console.error)
  // Start per-project schedulers
  startAllSchedulers(db, deps)
})

export { app }
