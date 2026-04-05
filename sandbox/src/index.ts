import express from 'express'
import { createDb } from './db/client.js'
import { sandboxRouter } from './routes/sandbox.js'
import { spawnRun } from './runner.js'

const port = parseInt(process.env.SANDBOX_PORT ?? '3004', 10)
const dbPath = process.env.DB_PATH ?? './sandbox.db'

const { db } = createDb(dbPath)

const app = express()
app.use(express.json())

app.use('/sandbox', sandboxRouter(db, spawnRun))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  console.log(`sandbox service listening on port ${port}`)
})

export { app }
