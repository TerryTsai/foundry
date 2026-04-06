import express from 'express'
import { createDb } from './db/client.js'
import { sandboxRouter } from './routes/sandbox.js'
import { spawnRun } from './runner.js'
import { config } from './config.js'

const { db } = createDb(config.dbPath)

const app = express()
app.use(express.json())

app.use('/sandbox', sandboxRouter(db, spawnRun))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(config.port, () => {
  console.log(`sandbox service listening on port ${config.port}`)
})

export { app }
