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
import { config } from './config.js'

const deps = { ticketUrl: config.ticketUrl, agentUrl: config.agentUrl }

const { db } = createDb(config.dbPath)

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

app.listen(config.port, async () => {
  console.log(`project service listening on port ${config.port}`)
  // Recover stalled tickets from a previous crash
  await recoverStalledTickets(db, deps).catch(console.error)
  // Start per-project schedulers
  startAllSchedulers(db, deps)
})

export { app }
