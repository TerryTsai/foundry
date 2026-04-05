import express from 'express'
import { createDb } from './db/client.js'
import { projectRouter } from './routes/projects.js'

const port = parseInt(process.env.PROJECT_PORT ?? '3001', 10)
const dbPath = process.env.DB_PATH ?? './project.db'

const { db } = createDb(dbPath)

// Dispatch stub — wired up fully in Phase 6 (scheduler)
async function dispatch(_projectId: string): Promise<void> {
  // TODO: Phase 6 — call ticket + agent services to dispatch open tickets
}

const app = express()
app.use(express.json())

app.use('/project', projectRouter(db, dispatch))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`project service listening on port ${port}`)
})

export { app }
