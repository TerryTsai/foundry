import express from 'express'
import { createDb } from './db/client.js'
import { ticketRouter } from './routes/tickets.js'
import { config } from './config.js'

const { db, sqlite } = createDb(config.dbPath)

const app = express()
app.use(express.json())

app.use('/ticket', ticketRouter(db, sqlite))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(config.port, () => {
  console.log(`ticket service listening on port ${config.port}`)
})

export { app }
